# A5-audit — Omni-view + unanchored reflow (B3)

> Read-only audit + design for the **A5** Wave-2 arena of the card-system refactor.
> Scope: the **Omni-view surface** (the unified in-text-aligned card column threaded from
> several panels) and the **B3 unanchored-card collision/reflow** problem. Audited **against
> the landed foundations** — A0 card SSOT (`src/cards/`) + AF `Floatable` subsystem
> (`src/floats/`), both merged to `main` at `e279864` (Session 10).
>
> Re-pinned against `HEAD = 588ae7e` (2026-06-09). Every `file:line` below was re-verified
> against the current tree; SSOT/older-audit drift is recorded in **Stale-ref corrections**.
> This chip is **read-only on source** — its only write is this file. It touches the
> text-object side **nowhere** (omni is card-only; the one text-object seam — example blocks —
> is read-only and routed through AF's key grammar already).
>
> **Dependency:** B3 reflow design sits **downstream of A4** (selection ⟂ expansion, N1). A4
> decides *when* a card's height changes (expand-without-select, compressed↔full). A5 owns
> *what the omni column does* when that height change happens. The reflow solver this audit
> designs is the consumer of A4's expansion events — it must not re-derive the modes matrix.

---

## 0. TL;DR

- **The omni-view is two layout regimes glued together, and only one of them reflows.**
  Anchored cards (those with a resolved doc `pos`) are absolute-positioned by a real cascade
  solver (`resolveCascade` in [`useInTextPositions.ts:115`](../../src/hooks/useInTextPositions.ts));
  **unanchored cards are dumped into a plain flow `<div>` ABOVE the anchored region**
  ([`OmniViewPanel.tsx:373-382`](../../src/panels/Omni/OmniViewPanel.tsx), `space-y-2`). The two
  regions **do not know about each other**. This is the structural root of B3.
- **B3 is real and has TWO distinct collision sub-cases**, not one:
  - **(B3-a) unanchored ↔ anchored top collision.** A note anchored on the **title** resolves
    to `pos ≈ 0`, so the cascade wants to paint it at pod-relative `top: 0`. But the unanchored
    flow block occupies the *flow* top of the same column and pushes the absolute `panelScrollRef`
    region down by its own height. When an unanchored note **expands**, the flow block grows and
    shoves the whole anchored region down — yet each anchored card's `top` was measured
    *pod-relative to `panelScrollRef`*, which just moved. A title-anchored card and the unanchored
    deck **fight for the same visual band**, and the absolute card can paint over the gap the flow
    left, or vice-versa, depending on measure timing.
  - **(B3-b) unanchored ↔ unanchored is actually FINE today** because they're in normal flow
    (`space-y-2`) — flow reflows for free. **But the moment B3 wants unanchored cards to align to
    *anything* (e.g. pin a free note at a chosen Y, or keep an expanding free note from jumping the
    deck), flow can't express it.** The current "fine" is an accident of them having no positioning
    requirement at all.
- **The deepest fix is to collapse the two regimes into ONE solver.** `resolveCascade` already
  is a general 1-D interval-packing solver over `{naturalTop, height}` rows with overlap-avoidance
  + a pin override. Unanchored cards are just rows with **no natural top** — give them a synthetic
  band (below the last anchored card, or a reserved zone) and feed them through the *same* cascade.
  One coordinate space, one overlap pass, one pin model. The "Unanchored" flow block disappears.
- **Cross-surface inconsistency is concrete, not hand-wavy.** The SAME card renders
  `compressedLines: 2` in omni ([`OmniViewPanel.tsx:356`](../../src/panels/Omni/OmniViewPanel.tsx))
  but `compressedLines: 1` docked (no `CardDisplayProvider` → default `1`,
  [`card-display.tsx:32`](../../src/components/editor-layout/contexts/card-display.tsx)). The docked
  panel is a flat sorted list ([`CardListPanel.tsx:132`](../../src/panels/_shared/CardListPanel.tsx),
  [`NotesPanel.tsx:69`](../../src/panels/Notes/NotesPanel.tsx)); omni splits anchored/unanchored and
  in-text-aligns. "Same card, same behavior docked vs omni" is **not** true today on two axes
  (compression depth, anchored/unanchored separation).
- **The filter rows are already registry-derived** (AF-fix converged this) — `categoryOf`
  ([`OmniViewPanel.tsx:125`](../../src/panels/Omni/OmniViewPanel.tsx)) parses the float key via
  `parseAnyKey` → `getPanelByCardKind` → `CARD_REGISTRY[k].panel`. This part is **clean**; A5
  should *not* re-touch it beyond consuming `cardKindsForPanel` for any future per-kind row.
- **Keystroke sanctity holds today and the reflow fix preserves it** — provided the new
  unanchored-into-cascade path stays **event-driven** (re-pack on expansion-state change /
  structural revision / card-height ResizeObserver), never on a per-keystroke `coordsAtPos` storm.
  The `resolvePos` live-position cache ([`OmniViewPanel.tsx:327-344`](../../src/panels/Omni/OmniViewPanel.tsx))
  is the keystroke-time seam and must keep rebuilding only on `DocStructure` snapshot-identity change.

---

## 1. Current reality (code-derived, EXACT file:line)

### 1.1 The pipeline: builders → host → panel
- **Per-panel builders** (`build<X>OmniItems(args): OmniItem[]`) live beside each panel:
  [`Notes/omni.tsx:28`](../../src/panels/Notes/omni.tsx), `Citations/omni.tsx`, `Footnotes/omni.tsx`,
  `Archive/omni.tsx`, `Todo/omni.tsx`, `Examples/omni.tsx:18`, `Revisions/omni.tsx`,
  `Errors/omni.tsx:27`, `Cutter/omni.tsx`, `Reports/omni.tsx`. Each returns `OmniItem[]`.
- **`OmniItem`** ([`panels/_shared/types.ts:38-46`](../../src/panels/_shared/types.ts)):
  `{ id: string; pos: number | null; content: ReactNode }`. The doc-comment at `:39` still says
  *"Shape: `${cardKind}:${id}`"* — **STALE** (real shape is `float:card:<kind>:<id>`; see Stale-refs).
- **`OmniHost`** ([`omni-host.tsx:147`](../../src/components/editor-layout/panels/omni-host.tsx))
  concatenates all builders into one memoized `items` array ([`:388-573`](../../src/components/editor-layout/panels/omni-host.tsx)),
  then applies a **fold filter (pass 1)** + **focus filter (pass 2)** → `displayedItems`
  ([`:597-632`](../../src/components/editor-layout/panels/omni-host.tsx)), and renders one
  `<OmniViewPanel>` per side ([`:634-644`](../../src/components/editor-layout/panels/omni-host.tsx)).
- **`OmniViewPanel`** ([`OmniViewPanel.tsx:246`](../../src/panels/Omni/OmniViewPanel.tsx)) does the
  layout: filter by enabled category → split anchored/unanchored → cascade the anchored → render.

### 1.2 `pos` assignment — where anchored vs unanchored is decided (the B3 fork)
A card lands in the **unanchored** bucket iff `item.pos == null`
([`OmniViewPanel.tsx:277-288`](../../src/panels/Omni/OmniViewPanel.tsx)). `pos` is set by each
builder, and there are **two ways to get `null`**:
1. **No anchor at all** — e.g. a note with zero linked text-objects:
   `getLinkedTextObjectIds(card).length === 0` → `{ pos: null }`
   ([`Notes/omni.tsx:71-72`](../../src/panels/Notes/omni.tsx)). This is the *intended* unanchored card.
2. **Anchor exists but is unresolvable** — `findParagraphPos(pid)` returns `null` when the
   paragraph UUID isn't in the live doc (orphaned anchor)
   ([`omni-host.tsx:290-305`](../../src/components/editor-layout/panels/omni-host.tsx); consumed at
   [`Notes/omni.tsx:75-79`](../../src/panels/Notes/omni.tsx),
   [`Errors/omni.tsx:33-36`](../../src/panels/Errors/omni.tsx)). An *anchored* card with a dead
   anchor **silently falls into the unanchored bucket** — same code path, no visual distinction.
- **Multi-anchor** notes emit one item per linked paragraph with an `@${pi}` suffix on the id
  ([`Notes/omni.tsx:74-80`](../../src/panels/Notes/omni.tsx)); each is independently anchored.
- The mount-race guard at [`OmniViewPanel.tsx:279-284`](../../src/panels/Omni/OmniViewPanel.tsx):
  while `editor` is null, `pos:null` items are **dropped** (not shown as unanchored) so they don't
  flash before the editor resolves UUIDs.

### 1.3 The anchored layout regime — the real solver
[`OmniViewPanel.tsx:346-347`](../../src/panels/Omni/OmniViewPanel.tsx) calls
`useInTextPositions(editor, inTextItems, true, "data-omni-entry-wrapper", pinned, resolvePos)`.
Inside ([`useInTextPositions.ts:198`](../../src/hooks/useInTextPositions.ts)):
- **Measurement** (DOM-touching, [`:222-302`](../../src/hooks/useInTextPositions.ts)):
  per item, `coordsAtPos(pos).top - podRect.top` → `naturalTop` (clamped ≥0,
  [`:272`](../../src/hooks/useInTextPositions.ts)); per card,
  `getBoundingClientRect().height` (viewport-gated, [`:274-281`](../../src/hooks/useInTextPositions.ts)).
  Writes `naturalRef` + bumps `measureVersion` only when values actually changed
  ([`:290-301`](../../src/hooks/useInTextPositions.ts) — the anti-feedback-loop guard).
- **Resolution** (pure JS, [`resolveCascade` :115-164`](../../src/hooks/useInTextPositions.ts)):
  sort rows by `naturalTop`; **forward pass** pushes each card below its predecessor's bottom
  (`prev.top + prev.height + MIN_GAP`, [`:139`](../../src/hooks/useInTextPositions.ts)); apply the
  **pin override** mid-loop ([`:142-144`](../../src/hooks/useInTextPositions.ts)); **backward pass**
  pulls earlier cards up to clear the pin ([`:152-159`](../../src/hooks/useInTextPositions.ts)).
  `MIN_GAP = 4`, `DEFAULT_ENTRY_HEIGHT = 60` ([`:79-80`](../../src/hooks/useInTextPositions.ts)).
- **This is a complete 1-D interval packer with a pin.** It already does exactly the collision
  avoidance B3 needs — it just never sees the unanchored cards.

### 1.4 The unanchored layout regime — no solver at all
[`OmniViewPanel.tsx:373-382`](../../src/panels/Omni/OmniViewPanel.tsx):
```
{unanchored.length > 0 && (
  <div className="px-2 pt-4 pb-2 space-y-2">
    <div …>Unanchored</div>
    {unanchored.map((item) => (<div key={item.id}>{item.content}</div>))}
  </div>
)}
```
A plain flow column with a header. It sits **before** the anchored `panelScrollRef` div in DOM
order, so it consumes flow height at the top of the column. The anchored region
([`:390-442`](../../src/panels/Omni/OmniViewPanel.tsx)) is `position: relative`,
`minHeight: editorContentHeight`, with absolute children at `translateY(top)` measured
**pod-relative to `panelScrollRef`** — i.e. relative to a div whose own flow-top is pushed down by
the unanchored block above it.

### 1.5 The pin model (per-card, single-pin-per-side)
- Store: [`omni-pin-store.ts`](../../src/components/editor-layout/omni-pin-store.ts) — module-scope
  `{ cardId, pinTop, version }` per side; `requestPin`/`clearPin`/`clearAll`;
  `usePinRequest(side)` via `useSyncExternalStore` ([`:104`](../../src/components/editor-layout/omni-pin-store.ts)).
- Producers: marker-click alignment ([`EditorLayout.tsx:1145-1168`](../../src/components/EditorLayout.tsx)
  `alignOmniCardWithClick`); `virgil-card-jumped` ([`EditorLayout.tsx:1177-1194`](../../src/components/EditorLayout.tsx));
  **pin-on-touch** — any mousedown on an anchored card publishes a pin at its current Y *before*
  the click toggles selection ([`OmniViewPanel.tsx:417-436`](../../src/panels/Omni/OmniViewPanel.tsx)).
- **Pin is anchored-only.** The pin-on-touch handler lives on the absolute wrapper at
  `:402` and pins via `pod.getBoundingClientRect()`. Unanchored cards (flow `<div>`) have **no
  pin-on-touch, no pin entry, no cascade participation** — so a free note that expands cannot keep
  its top fixed the way an anchored card can. (This is B3-b's latent gap.)

### 1.6 The live-position seam (keystroke-time) — `resolvePos`
[`OmniViewPanel.tsx:327-344`](../../src/panels/Omni/OmniViewPanel.tsx). `item.pos` is captured at
build time (structural-change-gated), so it goes stale as plain typing shifts later content.
`resolvePos` rebuilds a `Map<floatKey, pos>` from the live `DocStructure` snapshot
(`getBus(editor).structure`) **only when the snapshot identity changes** (`livePosCacheRef.current.s !== s`),
keyed via `cardPopKey("footnote"/"citation"/"example", id)` = `float:card:<kind>:<id>` to match the
omni `item.id`. Covers **footnote / citation / example** (the entity-anchored kinds whose primary
visualization is the in-text-aligned omni card); paragraph-anchored kinds (note/todo/archive/…)
fall through to the captured `pos` (their primary viz is the marginalia gutter, sourced live there).
**This is the AF-fix re-keying** (was legacy `note:`/`footnote:` keys; now `float:card:…`).

### 1.7 Filter / category / pin / hideAll — current behavior
- **Category filter** ([`categoryOf` :125-131`](../../src/panels/Omni/OmniViewPanel.tsx)):
  `parseAnyKey(id)` → guard `domain === "card"` → `getPanelByCardKind(kind)` → `entry.kind` if
  `omniEligible`. **Registry-derived, correct** (this was the AF-fix that killed the first-colon
  slice → `"float"` → null → "every card always visible" bug).
- **Filter menu** ([`OmniFilterMenu` :143-244`](../../src/panels/Omni/OmniViewPanel.tsx)): one row
  per omni-eligible panel placed on this side (`OMNI_CATEGORIES` from `OMNI_PANELS`,
  [`:44`](../../src/panels/Omni/OmniViewPanel.tsx)); "Default view" resets to `omniSide` defaults.
- **`hideAllCards`** ([`:266-272`](../../src/panels/Omni/OmniViewPanel.tsx)): per-side dashed-square
  toggle → suppress all rendering.
- **Empty state** ([`:368-372`](../../src/panels/Omni/OmniViewPanel.tsx)): only when
  `visibleItems.length === 0 && enabledCategories.size === 0`.

### 1.8 Selection / sticky / transient (the A4 seam, read-only here)
Omni selection flows through the `cardStore` (`anchored-card-store.ts`): background click →
`cardStore.setTransient(null)` ([`omni-host.tsx:204-206`](../../src/components/editor-layout/panels/omni-host.tsx));
focusin on a card body → `cardStore.markSticky()` ([`:209-211`](../../src/components/editor-layout/panels/omni-host.tsx),
wired from [`OmniViewPanel.tsx:256-265`](../../src/panels/Omni/OmniViewPanel.tsx)). Per-panel
`setSelectedXInOmni` callbacks clear sibling selections to keep omni single-selection
([`omni-host.tsx:212-361`](../../src/components/editor-layout/panels/omni-host.tsx)). **A4 owns the
selection ⟂ expansion model**; A5 only consumes the resulting height change. Today expansion is
driven by selection (`selected` prop → card renders full body) — once A4 lands
expand-without-select, the omni reflow must trigger on the *expansion* signal, not the selection id.

---

## 2. Wart — B3-a: unanchored block and anchored cascade are two un-coordinated coordinate spaces

**WHAT.** The omni column lays out anchored cards in an absolute region (`resolveCascade`, pod-relative
to `panelScrollRef`) and unanchored cards in a separate flow block *above* that region. The two
never reconcile. A title-anchored card (low `pos` → cascade `top ≈ 0`) and the unanchored deck both
target the visual top of the column and can overlap or leave a gap, especially as either side's
height changes on expand.

**WHERE.**
- Split: [`OmniViewPanel.tsx:274-291`](../../src/panels/Omni/OmniViewPanel.tsx) (`{anchored, unanchored}`).
- Unanchored flow block: [`OmniViewPanel.tsx:373-382`](../../src/panels/Omni/OmniViewPanel.tsx).
- Anchored absolute region pod: [`OmniViewPanel.tsx:390-394`](../../src/panels/Omni/OmniViewPanel.tsx)
  (`ref={panelScrollRef}`, `minHeight: editorContentHeight`).
- The cascade only ever receives `inTextItems` (anchored only):
  [`OmniViewPanel.tsx:293-296`](../../src/panels/Omni/OmniViewPanel.tsx).
- Confirming comments that this is a known quirk: panel-column caps the column to the editor's
  scrollHeight because *"Unanchored cards can stack the column taller than the editor"*
  ([`panel-column.tsx:300-308`](../../src/components/editor-layout/panel-column.tsx)) and
  *"panel columns can be taller than the editor (unanchored cards stack above the anchored ones)"*
  ([`editor-scrollbar.tsx:109-118`](../../src/components/editor-layout/editor-scrollbar.tsx)).

**WHY it's wrong.** Two layout authorities for one column means there is *no single function that can
guarantee non-overlap across the whole deck*. The cascade's overlap math is pod-relative to a pod
whose own top is set by the flow block it can't see. On expand:
- An unanchored note expanding grows the flow block → shifts `panelScrollRef` down → re-measure
  fires (ResizeObserver on the editor DOM doesn't, but the card's own ResizeObserver at
  [`useInTextPositions.ts:377-409`](../../src/hooks/useInTextPositions.ts) does) → anchored tops
  recompute against a moved pod. During the frame between the flow grow and the re-measure, a
  title-anchored absolute card paints at its stale `top` → momentary overlap / jump.
- The pin model only protects anchored cards; an expanding unanchored card has no pin so it shoves
  the whole anchored region rather than holding its own position.

**DEEPEST fix.** **One solver, one coordinate space.** Feed unanchored cards into `resolveCascade`
as rows with a *synthetic* natural top, deleting the flow block entirely. Two coherent placements:
- **(A) Unanchored-at-bottom band.** Unanchored rows get `naturalTop = (max anchored bottom) + GAP`,
  packed in a stable order (creation order / id). They flow below the document's anchored deck in the
  same absolute region — one overlap pass covers everything, the title-anchored card owns `top:0`
  cleanly, and an expanding unanchored card just pushes its unanchored siblings (and nothing above).
- **(B) Reserved unanchored zone at top, but *inside* the cascade.** If product wants unanchored
  notes visually first (today's placement), give them `naturalTop` in a reserved `[0, K)` band and
  shift the **anchored** band to start at `K` — but compute `K` *inside* the solver from the measured
  unanchored heights, so the anchored cascade's `podRect` reference and the unanchored band share one
  origin. No second flow authority.
Either way the fix is the same class: **the "Unanchored" section stops being a separate DOM/flow
construct and becomes a sub-range of the single cascade.** Recommend (A) — it matches the mental
model "anchored cards track their text; free notes collect at the end" and keeps the title band
unambiguous. (Confirm placement with Gabriel — Open question Q1.)

---

## 3. Wart — B3-b: unanchored cards have no positioning vocabulary, so "expand reflow" can't be expressed

**WHAT.** Because unanchored cards are flow-only, there is no pin, no cascade slot, no
`translateY` — so any future requirement to (a) keep an expanding free note from jumping the deck,
(b) pin a free note at a clicked Y, or (c) align a free note to a marker, is **unimplementable in the
current regime**. Today it "works" only because unanchored cards have zero alignment requirement.

**WHERE.**
- No pin-on-touch on the unanchored branch: only the anchored wrapper has it
  ([`OmniViewPanel.tsx:417-436`](../../src/panels/Omni/OmniViewPanel.tsx)); the unanchored map
  ([`:378-380`](../../src/panels/Omni/OmniViewPanel.tsx)) renders bare `<div key>{content}</div>`.
- The pin store's `cardId` doc-comment is anchored-centric (*"`data-omni-entry-wrapper` key — e.g.
  `citation:abc123`"*, [`omni-pin-store.ts:34`](../../src/components/editor-layout/omni-pin-store.ts) —
  also stale grammar, see Stale-refs).

**WHY it's wrong.** B3's spec ("expanding unanchored notes must reflow / avoid collisions") *presumes*
unanchored cards participate in a layout that can collide and therefore reflow. The current design
sidesteps collision by giving them no layout — which is exactly why it can't satisfy the spec the
moment expansion changes heights *and* the design wants them aligned to anything.

**DEEPEST fix.** Folding unanchored into the cascade (§2 fix) gives them the *same* vocabulary the
anchored cards have: a measured height, a cascade slot, pin-on-touch, `translateY`. Expand-reflow
then falls out of the existing forward/backward pass for free — no new mechanism. The pin-on-touch
handler ([`:417`](../../src/panels/Omni/OmniViewPanel.tsx)) moves onto the shared wrapper that *both*
anchored and (synthetic-top) unanchored cards render through.

---

## 4. Wart — cross-surface inconsistency: the same card looks/behaves differently docked vs omni

**WHAT.** A5's mandate is "same card looks/behaves the same docked vs omni." Two concrete divergences:
1. **Compression depth.** Omni sets `compressedLines: 2`
   ([`OmniViewPanel.tsx:356`](../../src/panels/Omni/OmniViewPanel.tsx)); the docked panel sets no
   `CardDisplayProvider`, so `useCompressedLines()` returns the default `1`
   ([`card-display.tsx:32`](../../src/components/editor-layout/contexts/card-display.tsx)). Every card
   kind reads it ([`NoteCard.tsx:85`](../../src/panels/Notes/NoteCard.tsx),
   [`FootnoteCard.tsx:105`](../../src/panels/Footnotes/FootnoteCard.tsx), +12 more). So a compressed
   note is a **1-line** truncation docked but a **2-line** one in omni.
2. **List structure.** Docked = flat sorted flow list
   ([`CardListPanel.tsx:132-139`](../../src/panels/_shared/CardListPanel.tsx);
   [`NotesPanel.tsx:69`](../../src/panels/Notes/NotesPanel.tsx) sorts but never splits
   anchored/unanchored). Omni = anchored/unanchored split + in-text-aligned absolute cascade. A note
   sitting mid-list docked is at the top in a separate "Unanchored" section in omni.

**WHERE.** [`OmniViewPanel.tsx:356`](../../src/panels/Omni/OmniViewPanel.tsx) vs the absence of a
provider around docked panels; [`card-display.tsx`](../../src/components/editor-layout/contexts/card-display.tsx).

**WHY it's wrong.** A5 explicitly wants cross-surface coherence (refactor DoD #5). The compression
divergence is undeclared (it lives in one literal in one file) and the list-structure divergence is
inherent to the two-regime design. Neither is *bad* per se — in-text alignment is the whole point of
omni — but the *card itself* (compression, chrome, typography) should be surface-invariant; only the
*positioning* should differ.

**DEEPEST fix.** Make the per-surface display knobs **declared and centralized**, not a stray literal:
the `CardDisplayContextValue` is the right seam — extend it to carry the surface identity and let
A9 (typography) own the actual numbers, but A5's job is to ensure **both** docked and omni go through
a `CardDisplayProvider` with an *intentional* value rather than one defaulting silently. The
list-structure divergence is acceptable-by-design (omni = aligned, docked = list) but must be the
*only* divergence; everything inside the card (compression, header, fonts) stays identical. Coordinate
the compression number with A9; A5 lands the provider symmetry.

---

## 5. Wart — orphaned-anchor cards masquerade as unanchored (no distinct treatment)

**WHAT.** A card that *has* a link but whose paragraph UUID no longer resolves (`findParagraphPos →
null`) lands in the identical `pos == null` bucket as a genuinely-unanchored card
([`OmniViewPanel.tsx:277`](../../src/panels/Omni/OmniViewPanel.tsx)), with no visual or behavioral
distinction. The user can't tell "I never anchored this" from "this lost its anchor."

**WHERE.** `findParagraphPos` null path ([`omni-host.tsx:290-305`](../../src/components/editor-layout/panels/omni-host.tsx))
feeding [`Notes/omni.tsx:75-79`](../../src/panels/Notes/omni.tsx),
[`Errors/omni.tsx:33-36`](../../src/panels/Errors/omni.tsx), etc.; bucket split at
[`OmniViewPanel.tsx:277-288`](../../src/panels/Omni/OmniViewPanel.tsx).

**WHY it's wrong.** The "Unanchored" header then lumps two semantically-different states. This is
adjacent to A2 (anchoring/orphans), but it *manifests* in the omni surface, so A5 must at least
expose the distinction to the layout (so an orphan can render an orphan badge — `OrphanBadge` already
exists at [`panel-primitives.tsx:277`](../../src/components/panel-primitives.tsx)).

**DEEPEST fix.** Thread the *reason* for `pos == null` from the builder: an `OmniItem` should carry
`anchorState: "anchored" | "free" | "orphaned"` rather than collapsing all three into a nullable
`pos`. The cascade-fold (§2) then places `free` and `orphaned` in the unanchored band but lets the
card render the orphan affordance. This is a small `OmniItem` type extension — coordinate the orphan
semantics with **A2** (which owns orphan detection); A5 owns the omni rendering of it.

---

## 6. Wart — the unanchored split logic + mount-race guard are duplicated implicit knowledge

**WHAT.** The rule "`pos == null` ⇒ unanchored, but only once `editor` is live" lives as inline
logic in `OmniViewPanel` ([`:274-291`](../../src/panels/Omni/OmniViewPanel.tsx)), while the
*reason* `pos` is null (no link vs unresolved link) lives in each builder, and the *fold/focus*
filters that can also remove items live in `omni-host` ([`:597-632`](../../src/components/editor-layout/panels/omni-host.tsx)).
Three places encode "which cards show where."

**WHERE.** [`OmniViewPanel.tsx:266-291`](../../src/panels/Omni/OmniViewPanel.tsx) +
[`omni-host.tsx:597-632`](../../src/components/editor-layout/panels/omni-host.tsx) + the 10 builders.

**WHY it's wrong.** Not a registry-fragmentation of the A0 kind (this is omni-local), but it does
mean the reflow solver can't reason about the full item set in one place. The fold/focus filters
return *fewer* items; the split bucket separates them; the cascade sees only a sub-slice.

**DEEPEST fix.** Centralize "classify each `OmniItem` into a layout band" in ONE pure function
(`classifyOmniItems(items, { editorReady, anchorState }) → { anchored, free, orphaned }`), consumed
by the single cascade. The fold/focus filters stay in `omni-host` (they're *visibility*, not
*layout*), but the *layout band assignment* becomes one function the solver owns.

---

## Target design — one cascade, registry-derived bands, surface-symmetric cards

**Shape (deepest fix, consuming the foundations):**

1. **Collapse the two layout regimes into the single `resolveCascade` solver.** Delete the
   flow `<div>` at [`OmniViewPanel.tsx:373-382`](../../src/panels/Omni/OmniViewPanel.tsx). Extend
   `useInTextPositions` (or a thin omni-specific wrapper) to accept rows with a **synthetic natural
   top** for free/orphaned cards (band placed below the last anchored card per §2-A). One overlap
   pass, one pin model, one `translateY` render path. The cascade already supports everything needed
   (`resolveCascade` is height-aware + pin-aware) — this is *feeding it more rows*, not rewriting it.
2. **`OmniItem` carries explicit `anchorState`** (`"anchored" | "free" | "orphaned"`) instead of a
   bare nullable `pos`. Builders set it; the classifier (§6 fix) bands on it; orphans render the
   existing `OrphanBadge`. Coordinate the `orphaned` semantics with **A2**.
3. **Reflow is event-driven, not keystroke-driven** (see Keystroke sanctity). The re-pack triggers
   on: expansion-state change (A4's signal), structural revision (block add/remove via the bus),
   card-height `ResizeObserver` ([`useInTextPositions.ts:377-409`](../../src/hooks/useInTextPositions.ts)),
   and window resize — **never** a raw `editor.on('update')`. The `resolvePos` live-position cache
   ([`OmniViewPanel.tsx:327-344`](../../src/panels/Omni/OmniViewPanel.tsx)) stays the *only*
   keystroke-time touch and keeps rebuilding solely on snapshot-identity change.
4. **Pin-on-touch becomes a shared wrapper concern.** The handler at
   [`OmniViewPanel.tsx:417-436`](../../src/panels/Omni/OmniViewPanel.tsx) moves onto the one wrapper
   both anchored and free/orphaned cards render through, so any card can hold its position on expand.
5. **Surface symmetry via declared display knobs.** Both docked and omni wrap their cards in a
   `CardDisplayProvider` with an *intentional* value (kill the silent default-1 docked path). The
   compression number and any future per-surface knob are A9-owned; A5 lands the provider symmetry so
   the card body is surface-invariant and only *positioning* differs.
6. **Filter rows stay registry-derived** — `categoryOf` + `OMNI_PANELS` + (future per-kind)
   `cardKindsForPanel` from the A0 predicates. **No change needed**; this is already converged.

**How it consumes the foundations:**
- **A0 (`src/cards/`):** `categoryOf` already routes through `getPanelByCardKind` →
  `CARD_REGISTRY[k].panel`; `cardKindsForPanel` is available if A5 ever needs per-kind filter rows.
  `cardPopKey` is the omni `item.id` SSOT (INVARIANT `omniKey === data-omni-entry === cardPopKey`).
- **AF (`src/floats/`):** `parseAnyKey`/`buildFloatKey` are the key grammar `categoryOf`/`resolvePos`
  depend on. Popping an omni card out is AF's job (the float key matches the omni id by INVARIANT) —
  A5 doesn't re-implement pop-out, it relies on the unified key so the popped float and the omni card
  are the same logical entity. The "pop-out from a compressed card" (B2) is A4+AF, surfaced in omni.

**Registry-derived where possible:** category rows (done), per-kind filter (available), the
anchorState band assignment (omni-local data, not a registry concept — stays in the classifier).

---

## Keystroke sanctity

**No per-keystroke doc-walk risk in the current omni code, and the reflow fix preserves it** — with
three invariants that MUST hold:

1. **`resolvePos` rebuilds only on `DocStructure` snapshot identity change.**
   [`OmniViewPanel.tsx:331`](../../src/panels/Omni/OmniViewPanel.tsx) gates the cache rebuild on
   `livePosCacheRef.current.s !== s`. The observer re-maps the snapshot every transaction but only
   *replaces* it on structural change, so plain typing → same `s` identity → cache reused → no
   per-character `Map` rebuild. **The reflow fix must not add a per-keystroke read here** — the
   synthetic-top computation for free cards uses *card heights* (ResizeObserver) and the *anchored
   max bottom* (already measured), neither of which is keystroke-proportional.
2. **`omni-host`'s `items` memo gates on data arrays + `editorInstance`, never an update counter.**
   [`omni-host.tsx:527-573`](../../src/components/editor-layout/panels/omni-host.tsx) deps are the
   per-panel data arrays + selection ids + stable callbacks + `editorInstance` — exactly the
   AGENTS.md "reactive editor, not a counter" pattern. `editorTick`
   ([`omni-host.tsx:161-187`](../../src/components/editor-layout/panels/omni-host.tsx)) bumps **only**
   on fold-toggle transactions + heading add/remove (bus events) — *not* on `docChanged`. The
   flicker-fix comment ([`:154-160`](../../src/components/editor-layout/panels/omni-host.tsx))
   documents that this was *previously* a per-keystroke `coordsAtPos` storm and is now event-gated.
   **The reflow fix must keep its re-pack trigger on these same bus/RO events.**
3. **`useInTextPositions.measure()` stays gated on the bus + ResizeObservers, not `editor.on('update')`.**
   [`useInTextPositions.ts:331-341`](../../src/hooks/useInTextPositions.ts) subscribes to
   `onBlocksAdded`/`onBlocksRemoved` (structural) + the editor-DOM ResizeObserver (wrap reflow) +
   the card ResizeObserver ([`:377-409`](../../src/hooks/useInTextPositions.ts), which **skips while
   typing into a card** to avoid jitter). Adding the unanchored rows must not introduce a new
   `editor.on('update')` subscriber — feed them through the same `measure()` pass.

**Event-driven reflow design (explicit):** the unanchored→cascade fold adds *rows*, not *triggers*.
The re-pack happens inside the existing `resolveCascade` `useMemo`
([`useInTextPositions.ts:414-417`](../../src/hooks/useInTextPositions.ts)), which depends on
`[measureVersion, items, pinned]`. `measureVersion` bumps only when measurements actually change
(structural / resize / card-height), so a plain keystroke that changes nothing structural triggers
**zero re-pack**. **Sanctioned subscribers this arena touches:** none added. It rides the
DocStructureBus (`onBlocksAdded`/`onBlocksRemoved`, `onHeadingsAdded`/`onHeadingsRemoved`) and the
two existing ResizeObservers. **Verify in impl:** `window.__virgilBusStats().emitCount` flat while
typing N plain chars with the omni column open AND an unanchored note expanded — no card reposition.

---

## Fragmentation table

| Surface | File(s) (`file:line`) | Disposition |
|---|---|---|
| Anchored/unanchored split | [`OmniViewPanel.tsx:274-291`](../../src/panels/Omni/OmniViewPanel.tsx) | **REPLACE** with a single `classifyOmniItems` → band assignment feeding one cascade |
| Unanchored flow block (no solver) | [`OmniViewPanel.tsx:373-382`](../../src/panels/Omni/OmniViewPanel.tsx) | **DELETE** — fold free/orphaned cards into `resolveCascade` as synthetic-top rows |
| Anchored absolute region | [`OmniViewPanel.tsx:390-442`](../../src/panels/Omni/OmniViewPanel.tsx) | **KEEP** the absolute `translateY` render; extend to host all bands |
| Cascade solver | [`useInTextPositions.ts:115-164`](../../src/hooks/useInTextPositions.ts) (`resolveCascade`) | **EXTEND** to accept synthetic-top rows (free/orphaned band); overlap/pin passes unchanged |
| Measurement pass | [`useInTextPositions.ts:222-302`](../../src/hooks/useInTextPositions.ts) | **EXTEND** to measure unanchored card heights via the same `entry` selector; no new subscriber |
| Live-position seam (keystroke) | [`OmniViewPanel.tsx:327-344`](../../src/panels/Omni/OmniViewPanel.tsx) (`resolvePos`) | **KEEP** — snapshot-identity-gated; do not add per-keystroke reads |
| Pin-on-touch (anchored-only) | [`OmniViewPanel.tsx:417-436`](../../src/panels/Omni/OmniViewPanel.tsx) | **HOIST** onto the shared wrapper so free/orphaned cards can pin too |
| Pin store | [`omni-pin-store.ts`](../../src/components/editor-layout/omni-pin-store.ts) | **KEEP**; fix stale `cardId` doc-comment grammar (`:34`) |
| Category filter | [`OmniViewPanel.tsx:125-131`](../../src/panels/Omni/OmniViewPanel.tsx) (`categoryOf`) | **KEEP** — registry-derived (AF-fix); no change |
| Filter menu | [`OmniViewPanel.tsx:143-244`](../../src/panels/Omni/OmniViewPanel.tsx) | **KEEP**; consume `cardKindsForPanel` only if per-kind rows are ever wanted |
| `OmniItem` type (nullable `pos`) | [`panels/_shared/types.ts:38-46`](../../src/panels/_shared/types.ts) | **EXTEND** with `anchorState`; fix stale `:39` doc-comment grammar |
| Fold/focus visibility filters | [`omni-host.tsx:597-632`](../../src/components/editor-layout/panels/omni-host.tsx) | **KEEP** (visibility, not layout); runs before the classifier |
| Per-surface compression knob | [`OmniViewPanel.tsx:356`](../../src/panels/Omni/OmniViewPanel.tsx) vs default-1 docked | **SYMMETRIZE** — both surfaces declare a `CardDisplayProvider` value (number owned by A9) |
| Column height cap (unanchored-aware) | [`panel-column.tsx:300-308`](../../src/components/editor-layout/panel-column.tsx), [`editor-scrollbar.tsx:109-118`](../../src/components/editor-layout/editor-scrollbar.tsx) | **REVISIT** — once unanchored folds into the cascade, the column-taller-than-editor case changes; verify the `--row-bound-h` cap still holds (the band below the editor's last anchor may extend the column intentionally) |
| Orphan badge | [`panel-primitives.tsx:277`](../../src/components/panel-primitives.tsx) (`OrphanBadge`) | **CONSUME** for `anchorState: "orphaned"` cards |
| Stale doc-comment | [`OmniViewPanel.tsx:30-36`](../../src/panels/Omni/OmniViewPanel.tsx) | **FIX** — grammar is `float:card:<kind>:<id>`, not `${cardKindPrefix}:${id}` |

---

## Definition of Done for this arena

1. **One layout solver.** The omni column places **every** card — anchored, free, orphaned — through
   a single `resolveCascade` pass over one coordinate space. The separate "Unanchored" flow block is
   gone. No card can overlap another regardless of anchor state or expansion.
2. **B3 satisfied.** Expanding any card (anchored OR unanchored) reflows the deck with no overlap and
   no over-paint of a neighbor — including the title-anchored-card-vs-unanchored-deck case. Verified
   live in the dev preview against `doc_devtest` (a title note + several free notes + anchored notes).
3. **Reflow is event-driven.** Re-pack fires only on expansion-state change, structural revision,
   card-height resize, and window resize. `__virgilBusStats().emitCount` flat on plain typing with
   the omni open and a free note expanded; no per-keystroke reposition.
4. **Cross-surface coherence.** The same card renders identically docked and in omni except for
   *positioning* — compression depth, chrome, typography are surface-invariant (both surfaces declare
   their `CardDisplayProvider` value intentionally). Coordinated with A9 for the numbers.
5. **Orphan distinction.** `anchorState` is explicit on `OmniItem`; orphaned-anchor cards render the
   orphan affordance, distinct from genuinely-free cards. Coordinated with A2.
6. **Pin parity.** Any omni card (free or anchored) can hold its position on expand via the shared
   pin-on-touch path.
7. **Filter rows stay registry-derived** (no regression of the AF-fix convergence).
8. **Stale doc-comments fixed** (`OmniViewPanel.tsx:30-36`, `:39` on `OmniItem`, `omni-pin-store.ts:34`).

---

## Open questions for the human

- **Q1 — Unanchored band placement (gates the reflow design).** Today free notes render in a flow
  block **above** the anchored deck. The deepest fix folds them into the cascade; should they live
  **below** the last anchored card (recommended — "anchored cards track their text; free notes
  collect at the end," makes the title band unambiguous) or stay **above** in a reserved zone
  computed inside the solver? (§2-A vs §2-B.)
- **Q2 — Orphaned vs free, one band or two?** Should orphaned-anchor cards (lost their paragraph) be
  visually/positionally distinct from genuinely-unanchored cards, or just badge-distinguished within
  one band? (Adjacent to A2's orphan model — A5 needs the band decision.)
- **Q3 — Compression depth symmetry.** Omni shows 2 compressed lines, docked shows 1. Unify to one
  number (which?), or is the per-surface difference intentional (omni cards have more horizontal
  room)? (Lands the value with A9; A5 needs the call to symmetrize the providers.)
- **Q4 — A4 sequencing.** B3 reflow consumes A4's expansion signal (expand-without-select). Confirm
  A5 impl lands **after** A4 ratifies the selection ⟂ expansion model, so the reflow trigger keys off
  the expansion event, not the selection id (the refactor doc already declares this dependency).
- **Q5 — Does the unanchored band extend the scroll column intentionally?** Folding free cards below
  the editor's last anchor means the omni column can extend past the editor's bottom. The current
  `--row-bound-h` cap ([`panel-column.tsx:307`](../../src/components/editor-layout/panel-column.tsx))
  exists *because* unanchored cards stacked tall. Confirm the desired scroll behavior when free notes
  collect below the document (scroll into a short trailing zone, or cap hard at the editor bottom?).

---

## Cross-arena seams

| Arena | Shared surface | Where (file:line) |
|---|---|---|
| **A4** (selection/focus/expansion) | The omni reflow **consumes** A4's expand-without-select signal; today expansion is selection-driven via `cardStore` (transient/sticky). A5's re-pack must trigger on the *expansion* event A4 defines, not the selection id. **Hard dependency — A5 lands after A4.** | `OmniViewPanel.tsx:256-265` (focusin→markSticky), `omni-host.tsx:204-211`, `anchored-card-store.ts:86,157`; reflow trigger in `useInTextPositions.ts:414-417` |
| **A2** (anchoring & orphans) | The `pos == null` orphan-vs-free distinction (§5) originates in A2's anchor model; A5 renders the resulting `anchorState` band + orphan badge. A5 needs A2's orphan-detection semantics threaded into `OmniItem`. | `omni-host.tsx:290-305` (`findParagraphPos`), `Notes/omni.tsx:75-79`, `Errors/omni.tsx:33-36`, badge at `panel-primitives.tsx:277` |
| **A9** (appearance & typography) | The cross-surface compression-depth divergence (§4) — A9 owns the actual `compressedLines` numbers + the two-typography-class rule; A5 lands the `CardDisplayProvider` *symmetry* so the card body is surface-invariant. | `OmniViewPanel.tsx:356`, `card-display.tsx:32`, the 14 `useCompressedLines()` call sites |
| **AF** (`Floatable`) | Popping an omni card out → a float; the omni `item.id` === `cardPopKey(kind,id)` === the float key (INVARIANT). "Pop-out from a compressed omni card" (B2) is AF+A4, surfaced here. A5 relies on the unified key so omni card and popped float are one entity; it does not re-implement pop-out. | `OmniViewPanel.tsx:333-337` (`cardPopKey` in resolvePos), `parseAnyKey`/`buildFloatKey` in `floats/float-key.ts` |
| **A0** (card spine) | Category filter + (future) per-kind rows derive from `CARD_REGISTRY[k].panel` / `cardKindsForPanel`. Already converged — A5 consumes, does not re-touch. | `OmniViewPanel.tsx:125-131` (`categoryOf` → `getPanelByCardKind`), `panel-registry.ts:261-272` |
| **A6** (marginalia gutter) | Paragraph-anchored kinds (note/todo/archive) have their *primary* live-position visualization in the marginalia gutter, which is why `resolvePos` covers only footnote/citation/example. If A6 changes how those kinds source live position, the omni `resolvePos` coverage decision must stay in sync. | `OmniViewPanel.tsx:318-322` (comment), `:333-337` (covered kinds) |

---

## Stale-ref corrections

| Ref (SSOT / older audit / in-code) | Status | Current location |
|---|---|---|
| SSOT §7 A5: `OmniViewPanel.tsx` "resolvePos" at `:331` (Session 8 NO-GO list) | line drift | `resolvePos` is now [`OmniViewPanel.tsx:327-344`](../../src/panels/Omni/OmniViewPanel.tsx); cache rebuild gate at `:331` (`livePosCacheRef.current.s !== s`) — that specific line still matches |
| SSOT Session-10 backlog: stale doc-comment `OmniViewPanel.tsx:32` | confirmed stale, still present | The header comment [`OmniViewPanel.tsx:30-36`](../../src/panels/Omni/OmniViewPanel.tsx) still says `${cardKindPrefix}:${id}` (e.g. `note:abc`) — wrong; real grammar `float:card:<kind>:<id>`. **Fix in impl.** |
| AF audit §1.5 / Session-8 #4: omni `resolvePos` keyed legacy `note:`/`footnote:` | FIXED (AF-fix) | Now re-keyed via `cardPopKey("footnote"/"citation"/"example", …)` = `float:card:…` ([`OmniViewPanel.tsx:333-337`](../../src/panels/Omni/OmniViewPanel.tsx)) to match the omni `item.id` |
| AF audit / Session-7 #4: "Omni category filter silently off" (`OmniViewPanel.tsx:149`, first-colon slice → `"float"` → null) | FIXED (AF-fix) | `categoryOf` now uses `parseAnyKey` → `getPanelByCardKind` ([`OmniViewPanel.tsx:125-131`](../../src/panels/Omni/OmniViewPanel.tsx)); the old line `:149` is now inside `OmniFilterMenu`, unrelated |
| `OmniItem` doc-comment "Shape: `${cardKind}:${id}`" | stale | [`panels/_shared/types.ts:39`](../../src/panels/_shared/types.ts) — real shape `float:card:<kind>:<id>`; `data-omni-entry` invariant at `:43-45`. **Fix in impl.** |
| `omni-pin-store.ts` `cardId` example "`citation:abc123`" | stale grammar | [`omni-pin-store.ts:34`](../../src/components/editor-layout/omni-pin-store.ts) — should read `float:card:citation:abc123`. **Fix in impl.** |
| `EditorLayout.tsx` omni scroll-to `"nt:id@0"` example | stale grammar (comment only; code uses starts-with `@`) | [`EditorLayout.tsx:2412`](../../src/components/EditorLayout.tsx) comment says `nt:id@0`; the selector at `:2415` correctly handles `[data-omni-entry^="${key}@"]` for the live `float:card:…@N` ids |
| Cheat-sheet "3 polymorphic panels / Notes,Revisions,Cutter appears as single filter row" | superseded | Omni filter rows are **PanelKinds** (`OMNI_CATEGORIES`), not card kinds — polymorphic panels are one row by construction ([`OmniViewPanel.tsx:42-48`](../../src/panels/Omni/OmniViewPanel.tsx)); Reports is also polymorphic (4 panels per A0 §3.7) |
