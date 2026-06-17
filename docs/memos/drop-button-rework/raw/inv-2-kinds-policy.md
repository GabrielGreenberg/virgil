# INV-2 — Anchored kinds + per-kind drop-placement policy

Read-only investigation. Repo root `/Users/gabriel/Programming/virgil`. All
file:line citations verified against working tree at investigation time.

---

## 0. TL;DR

- **16 card kinds** live in `CARD_REGISTRY` (`src/cards/card-registry.tsx:177-493`),
  type union `src/cards/types.ts:30-46`.
- **`anchored` is already a first-class registry facet** (`CardMeta.anchored`,
  `types.ts:141`; predicate `isAnchoredCardKind`, `predicates.ts:29`). 13 kinds
  are anchored; 3 are anchorless (`bib`, `ai`, `error`).
- **In-text-vs-margin is NOT a first-class facet.** It is *implicit*, encoded
  only inside each kind's `DropSpec.allowedPlacements` array, which is itself
  registered out-of-band (`src/cards/drop-specs/index.ts`) and folded onto
  `CARD_REGISTRY[kind].dropSpec` at boot. To know whether a kind drops in-text
  or in the margin today you must read the spec's factory and inspect
  `allowedPlacements`. **This is the scattered switch the feature should
  collapse into one facet.**
- The closest reusable existing notion is the `inlineAtomMoveSpec`
  (in-text / `inline-cursor`) vs `textObjectSideReanchorSpec`
  (margin / `paragraph-side`) factory split — but that is a *mechanism*
  distinction, not a *declared policy*. `predicates.isInlineAtomCardKind`
  (`predicates.ts:97`) already captures the footnote/citation in-text set as
  an explicit literal; it is the seed of the recommended SSOT.
- **No placement/anchor facet exists on the `Floatable` contract**
  (`src/floats/types.ts`) or `TextObjectMeta` to reuse — `canJump`/`jumpToSource`
  is the only anchor-adjacent field, and it means "has a source to scroll to,"
  not "where does a drop land." Do not invent on `Floatable`; the policy belongs
  on `CardMeta`.

---

## 1. Full enumeration of card kinds

Source: `CARD_REGISTRY` (`src/cards/card-registry.tsx:177-493`), union
`src/cards/types.ts:30-46` (declares "16 symmetric kinds").

| # | kind | panel | origin | `anchored` | `markerType` | inline-atom? | dropSpec registered? |
|---|------|-------|--------|-----------|--------------|--------------|----------------------|
| 1 | `note` | notes | user | **true** | `note` | no | yes (`noteDropSpec`) |
| 2 | `highlight` | notes | user | **true** | `null` (tint) | no | yes (`highlightDropSpec`) |
| 3 | `footnote` | footnotes | user | **true** | `null` (in-text atom) | **YES** | yes (`footnoteDropSpec`) |
| 4 | `citation` | citations | user | **true** | `null` (in-text atom) | **YES** | yes (`citationDropSpec`) |
| 5 | `example` | examples | derived | **true** | `null` | no | yes (`exampleDropSpec`) |
| 6 | `todo` | todo | user | **true** | `todo` | no | yes (`todoDropSpec`) |
| 7 | `archive` | archive | user | **true** | `archive` | no | yes (`archiveDropSpec`) |
| 8 | `report` | reports | user | **true** | `report` | no | yes (`reportDropSpec`) |
| 9 | `report-request` | reports | user | **true** | `report` | no | yes (`reportRequestDropSpec`) |
| 10 | `revision-comment` | revisions | user | **true** | `revision` | no | yes (`revisionDropSpec`) |
| 11 | `revision-suggestion` | revisions | user | **true** | `revision` | no | yes (`revisionDropSpec`, shared) |
| 12 | `cutter-comment` | cutter | user | **true** | `cut` | no | yes (`cutterCommentDropSpec`) |
| 13 | `cutter-suggestion` | cutter | user | **true** | `cut` | no | yes (`cutterSuggestionDropSpec`) |
| 14 | `bib` | bibliography | system | **false** | `null` | no | **no** (intentional, `:287`) |
| 15 | `ai` | null (cross-panel) | system | **false** | `null` | no | **no** |
| 16 | `error` | errors | system | **false** | `error` | no | **no** (also not poppable, `:490`) |

`anchored` per-kind evidence (the `anchored:` line in each `CARD_REGISTRY`
entry): note `:188`, highlight `:209`, footnote `:227`, archive `:245`,
todo `:265`, bib `:284` (false), citation `:301`, revision-comment `:325`,
cutter-comment `:347`, cutter-suggestion `:366`, revision-suggestion `:385`,
report `:402`, report-request `:425`, example `:444`, ai `:465` (false),
error `:483` (false).

`isInlineAtomCardKind` is the canonical in-text-atom set: literal
`k === "footnote" || k === "citation"` (`predicates.ts:97-98`), with a
dev-assertion that both carry `markerType === null` (`predicates.ts:100-113`).
Comment: it is **NOT cleanly facet-derivable** because `markerType === null` is
shared with `highlight` (a tint), `bib`/`ai` (unanchored), and `example`
(`predicates.ts:91-96`).

---

## 2. The drop-spec facet — how it folds onto the registry

### 2.1 Registration path
`CARD_REGISTRY[kind].dropSpec` starts `null` for every kind
(`card-registry.tsx`, each entry's `dropSpec: null`). At boot, importing
`@/cards/drop-specs` (forced by `drop-mode/registry.ts:23`) runs
`src/cards/drop-specs/index.ts:33-45`, which calls `registerCardDropSpec(kind, spec)`
(`card-registry.tsx:71-73`) once per anchored kind. `bib`/`ai`/`error` register
nothing (`index.ts:14-17` comment), so their `dropSpec` stays `null`.

`lookupSpec(cardKey)` (`drop-mode/registry.ts:49-63`) then reads
`CARD_REGISTRY[parsed.kind].dropSpec ?? undefined` (`:60`). So the registry IS
the SSOT for *which* spec, but the spec OBJECT (`DropSpec`,
`drop-mode/types.ts:209-236`) is where the placement intent hides.

### 2.2 The two factory families = the de-facto in-text/margin split

Every anchored card spec is built by exactly one of three factories. The
factory choice is what *implicitly* encodes placement:

**A. MARGIN (paragraph Mode-A) — `textObjectSideReanchorSpec`**
(`src/components/drop-mode/util/text-object-side-reanchor.ts:28-88`).
`allowedPlacements: ["paragraph-side"]` (`:32`), `targetScope: "main-only"`
(`:33`), `postDrop: "keep"` (`:86`). On release it re-anchors the card's
Mode-A paragraph link (`addTextObjectLink`/`removeTextObjectLink`, `:76-84`),
confirming first if already anchored elsewhere (`:47-52`). Used by:
- `note` (`Notes/drop-spec.ts:14`), `highlight` (`Notes/drop-spec.ts:19`)
- `todo` (`Todo/drop-spec.ts:8`)
- `archive` (`Archive/drop-spec.ts:8`)
- `cutter-comment` + `cutter-suggestion` (`Cutter/drop-spec.ts:11,16`)
- `revision-comment` + `revision-suggestion` (`Revisions/drop-spec.ts:11`, one
  shared spec)
- `report` + `report-request` (`Reports/drop-spec.ts:10,15`)

**B. IN-TEXT (inline atom) — `inlineAtomMoveSpec`**
(`src/components/drop-mode/util/inline-atom-move.ts:59-121`).
`allowedPlacements: ["inline-cursor"]` (default, `:66`),
`targetScope: "any-editor"` (`:67`), `postDrop: "keep"` (`:119`). On release it
relocates the `.tex` atom marker (the superscript / `\cite{}`) to the chosen
inline caret (`moveInlineAtomWithin`, `:142`). Used by:
- `footnote` (`Footnotes/drop-spec.ts:11`, `{nodeName:"footnote", idAttr:"footnoteId"}`)
- `citation` (`Citations/drop-spec.ts:10`, `{nodeName:"citation", idAttr:"citationId"}`)

**C. CONTENT-MOVE (not a re-anchor) — `blockMoveSpec`**
(`src/components/drop-mode/util/block-move.ts:26-67`).
`allowedPlacements: ["between-blocks"]` (`:28`), `targetScope: "any-editor"`
(`:29`), `postDrop: "close"` (`:65`). This MOVES the block node itself
(delete+insert) rather than re-anchoring a card. Used by:
- `example` (`Examples/drop-spec.ts:10`, `{nodeName:"exampleBlock"}`)

`example` is the odd one out — see §5.

### 2.3 The `Placement` vocabulary (the actual 3 shapes)
`drop-mode/types.ts:39-66`:
- `between-blocks` (`:42-48`) — thin horizontal line between block nodes.
- `paragraph-side` (`:51-57`) — 2px vertical bar in the gutter alongside a
  paragraph; carries `paragraphId` + `side`. **This is the "margin" shape.**
- `inline-cursor` (`:61-66`) — 2px caret-height bar at an inline char position.
  **This is the "in-text" shape.**

---

## 3. THE FULL TABLE — kind × anchored × placement × dropSpec

`placement` column derived from each kind's `DropSpec.allowedPlacements`
(verified via the factory each spec uses). "behavior" = what the drop does.

| kind | anchored | placement (`allowedPlacements`) | factory / behavior | dropSpec? |
|------|:--------:|----------------------------------|--------------------|:---------:|
| `footnote` | ✔ | **in-text** (`inline-cursor`) | `inlineAtomMoveSpec` — move `\footnote` marker | ✔ |
| `citation` | ✔ | **in-text** (`inline-cursor`) | `inlineAtomMoveSpec` — move `\cite` marker | ✔ |
| `note` | ✔ | **margin** (`paragraph-side`) | `textObjectSideReanchorSpec` — re-anchor paragraph | ✔ |
| `highlight` | ✔ | **margin** (`paragraph-side`) | `textObjectSideReanchorSpec` (Mode-B preserved on re-anchor) | ✔ |
| `todo` | ✔ | **margin** (`paragraph-side`) | `textObjectSideReanchorSpec` | ✔ |
| `archive` | ✔ | **margin** (`paragraph-side`) | `textObjectSideReanchorSpec` | ✔ |
| `report` | ✔ | **margin** (`paragraph-side`) | `textObjectSideReanchorSpec` | ✔ |
| `report-request` | ✔ | **margin** (`paragraph-side`) | `textObjectSideReanchorSpec` | ✔ |
| `revision-comment` | ✔ | **margin** (`paragraph-side`) | `textObjectSideReanchorSpec` (shared spec) | ✔ |
| `revision-suggestion` | ✔ | **margin** (`paragraph-side`) | `textObjectSideReanchorSpec` (shared spec) | ✔ |
| `cutter-comment` | ✔ | **margin** (`paragraph-side`) | `textObjectSideReanchorSpec` | ✔ |
| `cutter-suggestion` | ✔ | **margin** (`paragraph-side`) | `textObjectSideReanchorSpec` | ✔ |
| `example` | ✔ | **between-blocks** (content move) | `blockMoveSpec` — moves the block, NOT a re-anchor | ✔ |
| `bib` | ✘ | — none — | no spec (`:287` "bib entries don't anchor to text") | ✘ |
| `ai` | ✘ | — none — | no spec | ✘ |
| `error` | ✘ | — none — | no spec (also not poppable) | ✘ |

### Placement partition for requirement (5)
- **IN-TEXT** (caret / atom position): `footnote`, `citation`. (2 kinds)
- **MARGIN** (paragraph horizontal band): `note`, `highlight`, `todo`,
  `archive`, `report`, `report-request`, `revision-comment`,
  `revision-suggestion`, `cutter-comment`, `cutter-suggestion`. (10 kinds)
- **BLOCK-MOVE / special**: `example` — see §5; arguably *should not* get the
  button, or gets it with distinct semantics. **DESIGN-CALL.**
- **NO BUTTON** (anchorless, requirement (1)): `bib`, `ai`, `error`.

---

## 4. KEY ARCHITECTURE QUESTION — is in-text-vs-margin a clean facet?

**No.** It is implicit and scattered:

1. The distinction exists only as the **factory chosen** in each
   `src/panels/<panel>/drop-spec.ts` file, expressed via
   `DropSpec.allowedPlacements` (`drop-mode/types.ts:211`).
2. `allowedPlacements` is an *array of allowed geometries* (priority-ordered,
   `hit-test.ts:101`), not a single declared "this kind lands in-text vs
   margin" intent. Today each anchored card happens to declare exactly one
   geometry, so the array degenerates to a single value — but nothing in the
   type system says so, and `example` uses a third value (`between-blocks`)
   that is neither.
3. To answer "does this kind drop in-text or in the margin?" a caller must:
   `CARD_REGISTRY[kind].dropSpec?.allowedPlacements` → inspect the array →
   map `inline-cursor`→in-text, `paragraph-side`→margin, `between-blocks`→?.
   That is exactly the per-kind switch the central design principle says to
   collapse.
4. `predicates.isInlineAtomCardKind` (`predicates.ts:97`) partially captures
   the in-text set but is a hand-kept literal explicitly documented as *not*
   facet-derivable (`predicates.ts:96`), and it conflates "is an inline atom
   node" with "drops in-text" (true today, but coincidental).

### Where the facet SHOULD live — recommended SSOT shape

Add a declarative `dropPlacement` facet to `CardMeta`
(`src/cards/types.ts:108`, beside `anchored` and `dropSpec`):

```ts
/** Where a (re)anchor drop for this kind LANDS — the policy the drop
 *  button + the controller dispatch through. `null` for anchorless kinds
 *  (bib/ai/error) that take no drop button. DERIVED-CONSISTENT with the
 *  kind's dropSpec.allowedPlacements (a dev assertion pins the two). */
dropPlacement: "in-text" | "margin" | null;
```

Per-kind values:
- `in-text`: `footnote`, `citation`
- `margin`: `note`, `highlight`, `todo`, `archive`, `report`,
  `report-request`, `revision-comment`, `revision-suggestion`,
  `cutter-comment`, `cutter-suggestion`
- `null`: `bib`, `ai`, `error`, **and `example`** (it is a block content move,
  not a re-anchor — see §5; a `null` here cleanly excludes it from the button
  set without a special case).

Then everything routes through ONE policy:
- **Requirement (1) — who gets the button:** `dropPlacement !== null`
  (equivalently `anchored && dropPlacement !== null`, which also drops
  `example`). A new predicate `cardTakesDropButton(kind)` /
  `cardDropPlacement(kind)` in `predicates.ts` reads this facet, mirroring
  `isAnchoredCardKind`.
- **Requirement (5) — in-text vs margin:** the button's grab handler and the
  drop controller read `cardDropPlacement(kind)` instead of re-deriving from
  `allowedPlacements`. No per-kind `if (kind === "footnote" || ...)`.
- The existing `DropSpec.allowedPlacements` becomes the *mechanism* the facet
  *implies*; a dev assertion (mirroring `assertMorphCoverage`
  `card-registry.tsx:120`, `assertMarkerCoverage` `marker-meta.ts:123`) pins
  `dropPlacement === "in-text"` ⇔ spec.allowedPlacements == `["inline-cursor"]`
  and `dropPlacement === "margin"` ⇔ `["paragraph-side"]`, so the two never
  drift.

This is the deepest move: it promotes the existing implicit factory choice to
a declared facet on the same SSOT (`CARD_REGISTRY`) that `anchored`,
`markerType`, `dropSpec`, and `morph` already live on, and it makes the
"which cards get the button" and "where does the drop land" questions O(1)
registry reads instead of spec-array introspection. It also subsumes the
hand-kept `isInlineAtomCardKind` literal for *this* purpose (the literal can
stay for its node-existence meaning, but the drop path stops depending on it).

**Alternative considered (rejected):** putting `placement` on `DropSpec`
itself (`drop-mode/types.ts:209`). Rejected because (a) the button-eligibility
question ("requirement 1") needs the facet *before* a drop session exists, when
the natural lookup is by kind on the registry, not by an active spec; and (b)
`DropSpec` is also used by non-card transient specs (atom-grab, stack-pull,
text-object, text-range-move — `registry.ts:31-34,55-57`) where a card-centric
"in-text vs margin" label is meaningless. Keep the *declared policy* on
`CardMeta` (the card spine) and let `DropSpec` keep the *mechanism*
(`allowedPlacements`).

---

## 5. `example` — the special case (DESIGN-CALL)

`example` is `anchored: true` (`card-registry.tsx:444`) but its spec is
`blockMoveSpec` (`Examples/drop-spec.ts:10`), which is a `between-blocks`
**content move** (delete+insert the `exampleBlock` node, `postDrop:"close"`,
`block-move.ts:43-66`) — NOT a card re-anchor. Its lifecycle is the
`exampleBlock` TextObject's, not the card's (`card-registry.tsx:446-449`,
"origin:derived; a card-level clone/delete would double-act"). So an example
"card" is a mirror of a doc block; "re-anchoring" it means moving the block.

Implication for the feature: a drop button on an example card would either
(a) be omitted (treat `example` as non-button, `dropPlacement: null`), or
(b) trigger the block move (between-blocks placement). The 7 requirements speak
of "anchor an unanchored card OR re-anchor an already-anchored card" and
in-text/margin placement — neither maps to "move a block." **Recommend
omitting the button for `example` (dropPlacement: null) unless Gabriel wants
example blocks to be drag-relocatable from the card.** Surfaced as a design
call.

---

## 6. Floatable contract / TEXT_OBJECT_REGISTRY — nothing to reuse

- `Floatable` (`src/floats/types.ts:66-128`): no placement/anchor facet. The
  only anchor-adjacent fields are `canJump: boolean` (`:117`) and
  `jumpToSource()` (`:115`) — "reveal where this lives," a scroll-to, not a
  drop target. `canRedock` (`:111`) is panel-dock-flow, unrelated. Do not add
  the placement policy here — `Floatable` is the *window presence* role and is
  blind to card kind by design (`float-policy` / `types.ts:5-11`).
- `TextObjectMeta` (`src/text-objects/types.ts:225`): has `chromeAnchor`
  ("text-top"/"block-top", a *float-chrome geometry* hint, not a drop policy),
  `isRange`, and per-kind `dropAdapter`/`collectMoveSource` — these drive the
  text-object move machinery (`drop-spec-matrix.test.ts`), a separate
  abstraction from card re-anchoring. The text-object `dropAdapter` answers
  "wrap vs drop-direct vs nothing" for block moves, which is the §5 `example`
  family, not the margin/in-text card split. No reusable in-text/margin facet.
- The hit-test already owns the geometry→placement mapping
  (`hit-test.ts:101-111`); the new facet feeds *which* placements the spec
  allows, it does not duplicate the geometry resolution.

**Conclusion:** the placement policy is genuinely a *card* concern with no
existing host facet — invent it on `CardMeta`, derive predicates in
`predicates.ts`, pin it to the spec with a dev assertion.

---

## 7. Cross-cuts the synthesis/plan must know (beyond INV-2's strict scope)

These came up while tracing and are load-bearing for requirements (1),(3),(6),(7):

### 7.1 Requirement (1) — button placement precedent ALREADY EXISTS
`EditableCard` already renders a **chevron-right jump-to-source button
"immediately left of the close X," but only when popped out**
(`panel-primitives.tsx:818-822`: `canJump`/`onJump`; "Docked cards never show
the jump button"). The new drop button wants the *same slot* but on *docked*
cards too. The header trailing chrome is assembled around
`panel-primitives.tsx:951,998-1000` (`headerTrailing`, `canJump`, `onJump`
threaded into the unified header). The close "X" is `popoutVariant`/close
control (`panel-primitives.tsx:1282-1433`, `PopoutButton` family). **The
double-chevron drop button (requirement 2) slots into this same
canJump-adjacent region**, left of the X.

### 7.2 Requirement (3)+(7) — the gesture to add, and the one to retire
- **RETIRE (req 7):** the SHIFT-grab lives at **`FloatingPanel.tsx:432-441`**
  (`if (e.shiftKey && cardKey && mode === "floating")` →
  `beginDropSession`). It only works on a **popped-out float header**, never a
  docked card. This is the "old shift-grab technique" to remove.
- **ADD (req 3):** mirror the **in-text atom grab** threshold-drag
  (`src/lib/tiptap/inline-atom-grab.ts:125-194`): mousedown on the button →
  on >threshold move call `beginDropSession({cardKey, origin, inPlace?,
  externalCommit})` (`:145`) and lift a ghost; controller drives hit-test +
  indicator; mouseup → `commitDropSession()`. NOTE: the atom grab is a *plain*
  (no-shift) mousedown directly on the glyph (`:204-211` rejects modifiers) —
  it is NOT the retired technique; it is the model for the new button gesture.
- `beginDropSession` (`controller.ts:90-128`) already no-ops gracefully when no
  spec is registered (`:106`) and supports both `inPlace` (no float to dim) and
  `externalCommit` (caller owns mouseup) — the new button is an `inPlace:true,
  externalCommit:true` session sourced from a docked card, exactly like the
  atom grab.

### 7.3 Requirement (6) — paragraph horizontal band including margins: GAP
The margin drop currently resolves the target paragraph via
`hitTest` → `findEditorAtPoint(x,y)` (`hit-test.ts:46`) →
`editor.view.posAtCoords({left:x,top:y})` (`:54`). `paragraph-side` is the
last-priority placement and returns regardless of x once a block resolves
(`hit-test.ts:108-110`, `makeParagraphSidePlacement` picks left/right by which
half the cursor is in, `:622-646`). **BUT** `findEditorAtPoint` uses
`document.elementsFromPoint` (`target-registry.ts:45-58`), which only returns
the `.ProseMirror` editor when the cursor is geometrically **over the editor's
box**. And `posAtCoords` resolves a position only within the content column.
So a cursor truly in the **left/right page gutter outside the `.ProseMirror`
box** will fail to resolve a paragraph today. Requirement (6) ("anywhere in the
paragraph's HORIZONTAL BAND including the left/right margins is sufficient")
therefore needs **new horizontal-band hit-resolution** for the margin
placement: given a y, find the paragraph whose vertical band contains y
(independent of x) and pick a side. This is a real implementation gap, not
covered by the existing hit-test. **Flag for the controller/hit-test chip.**
(Caveat: if the `.ProseMirror` element's box already spans the full text column
width with the gutters being editor padding *inside* the box, margins within
that padding DO resolve; the gap is specifically the region outside the
`.ProseMirror` element. Needs live verification — OPEN-VERIFICATION.)

---

## 8. Open verifications / things the code couldn't fully settle

1. **OPEN-VERIFICATION (req 6):** exact horizontal extent of the
   `.ProseMirror` box vs the visible text column / page gutter — determines
   whether "including the margins" needs new hit-resolution or just works.
   Needs a live measurement of `.ProseMirror.getBoundingClientRect()` vs the
   page layout. (See §7.3.)
2. **DESIGN-CALL (req 1/5):** does `example` get the button? It is `anchored`
   but its drop is a block content-move, not a re-anchor. Recommend `null`
   placement (no button). (See §5.)
3. **DESIGN-CALL (req 4):** "anchor an UNANCHORED card." For margin kinds the
   `textObjectSideReanchorSpec` already handles `current.length === 0` →
   `{kind:"apply"}` with no confirm (`text-object-side-reanchor.ts:44-46`), so
   anchoring an unanchored margin card already works. For in-text kinds
   (footnote/citation) the spec assumes the atom already exists in the doc
   (`locateAtom`, `inline-atom-move.ts:204`); a footnote/citation card whose
   atom was deleted is "unanchored" with no atom to move — re-inserting an atom
   is a different op than moving one. Whether the button must *create* an atom
   for an orphaned in-text card is unspecified. Flag.
4. **CONFIRM:** the union says "16 symmetric kinds" (`types.ts:24`); registry
   has exactly 16 entries (counted: §1 table). Consistent.
