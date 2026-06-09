# A4-audit — Selection, focus & keyboard (N1 modes matrix; one-click expand + pop-out-without-select)

<!-- audited against HEAD 588ae7e (2026-06-09); foundations A0+AF landed+merged (e279864) -->

## 0. TL;DR

N1 (selection ⟂ expansion, full 2×2) is **ratified** but **not realized in code**. The data layer (`anchored-card-store.ts`) *does* keep two slots — a single-card `primary` (selection/halo) and a multi-card `stickySet ∪ {transient}` (expansion). But the **two axes are welded together at the action level and at the transient slot**, so in practice N1's independence is violated three ways:

1. **One action moves both axes.** Every docked card's `onClick` calls `cardStore.toggleSelection(ref)` — a single primitive that *simultaneously* sets `transient` (→ selection/halo via primary) **and** adds to `stickySet` (→ expansion). There is **no expand-only action** and **no select-only action** for a body click. Clicking a card always does both. (`anchored-card-store.ts:129-152`; ~12 identical call sites — `NoteCard.tsx:112`, `Footnotes/FootnoteCard.tsx:128`, `Citations/CitationCard.tsx:705`, `Todo/TodoRow.tsx:140`, etc.)
2. **`transient` is in the expanded set, so SELECT-only paths auto-EXPAND.** `useIsExpanded = stickySet ∪ {transient}` (`:267-276`). A main-text **marker click** (`marker-clicks.ts:128/172/293…`) only intends to *select* (set transient → scroll/halo), but because `transient ⊂ expanded`, the card silently **expands too**. This is exactly the "selecting must NOT auto-expand" prohibition, structurally embedded.
3. **There is no one-click EXPAND affordance and no one-click POP-OUT affordance on a docked card.** Expand is only reachable by the combined body-click (B1 fail). Pop-out is reachable only via the drag-handle **lift gesture** (`panel-primitives.tsx:1574-1692`) — which, to its credit, is *already* decoupled from selection and *already* works on a collapsed card (`:1575-1578`), so **B2 is largely satisfied at the gesture layer** but is undiscoverable (no click target) and the docked header has no popout button at all (`:1734-1738`).

**Deepest fix:** split `toggleSelection` into two orthogonal primitives — `toggleExpanded(ref)` (mutates `stickySet` only) and `select(ref)`/`focus(ref)` (mutates the *selection* axis only) — and **remove `transient` from the expansion set** by introducing a dedicated single-slot `selected` axis that is independent of `expanded`. Cards render a one-click expand chevron (drives `toggleExpanded`) and a one-click popout button on the docked header (drives the existing lift handoff target). Marker clicks call `select` only (no expand). Body-click default becomes a ratification question (expand-only vs expand+select). Registry-derive nothing new here (this is interaction state, not card metadata) but consume `isAnchoredCardKind`/`EntityKind` for the operand set. Net: a clean 2×2 where every cell is reachable in one click and pop-out is independent of both.

Findings: **11**. Confidence: **high** on the model (the conflation is concrete and uniform); **medium** on the body-click default and the multi-select keyboard story (under-specified today, needs Gabriel).

---

## 1. Current reality (code-derived, EXACT file:line) — against the finished foundations

### 1.1 The selection/expansion store (`src/links/_shared/anchored-card-store.ts`)

Module-scope `useSyncExternalStore` store (not Context — so popped floats in portals observe it; `:8-15`). State shape (`:41-47`):

```ts
interface CardInteractionState {
  stickySet: AnchoredCardRef[];   // hand-clicked / focus-promoted; multi
  transient: AnchoredCardRef | null;  // ≤1; marker-click ephemeral
  hover: AnchoredCardRef | null;
}
```

`AnchoredCardRef = { kind: EntityKind; id: string }` (`:36-39`) — typed on `EntityKind` (the 13-kind anchored subset, `entity-hover.ts:22-38`), **not** `CardKind`. So `bib`/`ai`/`error` are *not* in this store at all (their selection is plain `useState`, `selections.tsx:45-50`, `EditorLayout.tsx:1487-1488`).

**Two derived axes (the heart of the matter):**
- `isExpanded(ref)` ≡ `refsEqual(transient, ref) || stickyIndex(ref) !== -1` (`:73-76`, `:183-185`, `:267-276`). **Multi-card. Includes `transient`.**
- `isSelected(ref)` ≡ `refsEqual(primaryRef(), ref)` where `primaryRef = transient ?? stickySet[last]` (`:78-80`, `:177-179`, `:259-263`). **Single-card halo.**

The docstring (`:27-31`) explicitly frames these as "distinct" — and at the *read* level they are. The break is at the *write* level (§1.2) and in the fact that `transient` is a member of **both** (`isSelected` via `primaryRef`, `isExpanded` directly).

**The combined-write primitive — `toggleSelection(ref)` (`:129-152`):**
- If `ref` is primary AND in sticky → remove from sticky + clear transient if equal (close).
- Else → `stickySet ∪= {ref}` **and** `transient = ref` (open + focus).

So the "open" branch **always sets both axes**. There is no primitive that touches expansion without also moving the halo, and none that moves the halo without also pinning expansion.

Other writers: `setTransient` (`:86-90`), `addSticky`/`removeSticky` (`:93-107`), `markSticky` (promote transient→sticky on focus, `:157-173`), `setSelection` back-compat shim (`:193-203`).

### 1.2 How every card consumes it — the uniform conflation (~12 sites)

The canonical binding is `useAnchoredCard(ref)` (`useAnchoredCard.ts:50-79`), returning `{ selected, expanded, hovered, props }`. `props.onClick = () => cardStore.toggleSelection(ref)` (`:71`). Cards then **override** the click for their own select/jump side effects but keep `toggleSelection` as the first call:

```ts
// NoteCard.tsx:111-118 (representative; identical shape in 12 cards)
onClick={(e) => {
  cardStore.toggleSelection(ac.ref);          // ← moves BOTH axes
  if (!cardStore.isExpanded(ac.ref)) return;  // bail if the toggle closed it
  onSelect(note.id);                          // legacy per-kind slot
  if (onJump) onJump(...);
}}
```

Identical at: `Notes/NoteCard.tsx:112`, `Notes/HighlightCard.tsx:105`, `Footnotes/FootnoteCard.tsx:128`, `Citations/CitationCard.tsx:705`, `Todo/TodoRow.tsx:140`, `Archive/ArchiveCard.tsx:91`, `Cutter/CutterCommentCard.tsx:114`, `Cutter/CutterSuggestionCard.tsx:362`, `Examples/ExampleCard.tsx:118`, `Reports/ReportCard.tsx:98`, `Revisions/RevisionCommentCard.tsx:124`, `Revisions/RevisionSuggestionCard.tsx:275`. (Reports/ReportRequest follow the same pattern.)

**Expansion display.** Each card computes `const compressed = !isExpanded && !isPoppedOut;` and passes `compressed`/`compressedSummary` to `EditableCard`/`PanelCard` (`NoteCard.tsx:86,144`; same line-shape across all listed cards). `isExpanded` here is `ac.expanded || selected` (`NoteCard.tsx:77`) — i.e. the multi-card store axis OR the legacy per-kind `selected` prop. So the **display axis is `expanded`** (correct direction), but `expanded` is fed by `transient` (marker selects) and by `toggleSelection` (which also selects). The one outlier still gating display on `selected` is **`Errors/ErrorCard.tsx:112`** (`const compressed = !selected && !isPoppedOut;`) — error isn't in the anchored store, so it has no `expanded` axis; this is acceptable but inconsistent.

**The `compressed` docstring is the smoking gun** (`panel-primitives.tsx:692-693`):
> "Driven by `!selected && !isPoppedOut` at the consumer. **Selection is the expansion mechanism** — see plan in i-want-to-introduce-iridescent-spark."

That comment is stale (consumers actually gate on `expanded`, not `selected`) but documents the original conflated intent that the store still encodes.

### 1.3 Marker-click (main text → card): SELECT that silently EXPANDS

`marker-clicks.ts` handles footnote/citation/marginalia clicks in the editor. Each does `suppressNextPlacement(); setSelected<Kind>Id(id); openForCard(...)` (`:127-131`, `:171-178`, `:291-310`). `setSelected*Id` routes through `makeKindSetter` → `cardStore.setTransient({kind, id})` (`selections.tsx:61-75`). Because `transient ∈ expanded` (§1.1), **the card expands as a side effect of a pure marker selection** — the exact N1 violation. The intent here is select-and-scroll (`usePlacement` alignment + `openForCard`), not expand.

### 1.4 Scroll-on-select (the SELECTION axis, working correctly)

`usePlacement` (`usePlacement.ts:68-152`) subscribes to `useSelection()` (the primary) and, on a *selection change*, scrolls the editor so the closest in-view anchor aligns with the card's Y (`:109-150`). This is a clean **selection-axis** behavior (card→text alignment), correctly gated on the single primary, with a suppress flag for marker clicks (`:161-192`) that do their own (text→card) alignment. **This part already honors N1's "selection = scroll-on-select" leg.** It must continue to fire on the *selection* axis only after the split — not on expand.

### 1.5 Pop-out / float birth gesture (B2 surface)

The birth gesture lives in `PanelCard.onWrapperMouseDown` (`panel-primitives.tsx:1574-1692`):
- **Already decoupled from selection** — it reads only `cardKey`, `isPoppedOut`, header subtree containment; it never consults the store's selected/expanded state.
- **Already works on a collapsed card** — explicit comment + guard at `:1575-1578`: *"Lift-to-popout is allowed in both expanded and collapsed states … Only a popped card disables the gesture."* (The stale `isCollapsed` prop, `:1446-1448`/`:874`, claims "lift is disabled when collapsed" — that is **dead/contradicted** by the actual guard; `isCollapsed` now only gates the trash button at `:1762`.)
- On threshold cross it sets `setCardLiftTarget` + `setCardLiftHandoff` (`card-lift.ts:51-102`) and calls `popped.popOutAtRect(cardKey, spawn)` (`:1652-1659`) → AF's `FloatWindow` consumes the handoff (`consumeCardLiftHandoff`, `card-lift.ts:95-102`).

So **B2 is satisfied at the gesture layer** and correctly coordinates with **AF Seam 1** (domain owns birth gesture `panel-primitives.tsx`; subsystem owns the float result via `usePoppedCards.popOutAtRect` → `FloatWindow`/`FloatChrome`). The gaps are *discoverability and parity*, not capability:
- **No popout button on the docked header** (`panel-primitives.tsx:1734-1738`: the X/popout button renders `&& isPoppedOut` only). Pop-out is drag-only and undiscoverable.
- Lift only fires from the **header subtree** (`:1583-1586`) — a collapsed card whose header is tiny still works, but a one-click target would be clearer.

### 1.6 Expand affordance (B1 surface)

There is **no expand/collapse button**. `Chevron` exists (`panel-primitives.tsx:1088-1099`) but is used for *dropdowns* (HeaderAddDropdown, kind dropdown), not card expansion. The only way to expand a docked card is the combined body `onClick` (§1.2), which also selects. **B1 fails: expand is gated on (and entangled with) selection.**

### 1.7 Keyboard & a11y

- **Roving tabindex is keyed on SELECTION, not a roving cursor:** `EditableCard` passes `tabIndex={selected ? 0 : -1}` to `PanelCard` (`panel-primitives.tsx:879`). So only the single selected card is tabbable; there is no independent keyboard cursor and no arrow-key roving within a panel list.
- **`aria-selected`** is emitted by `useAnchoredCard` when `selected` (`useAnchoredCard.ts:72`). **`aria-expanded` is NOT emitted on cards** — the only `aria-expanded` in panel-primitives is on the Add dropdown button (`:1896`). So the 2×2 has no a11y surface for the expansion axis.
- **No per-panel keyboard cycling exists today** for cards. `CardListPanel` docstring claims `useCycle`/`PrevNextCounter` are passed via `headerExtras` (`CardListPanel.tsx:6-7`) but **no `useCycle` module exists** (grep: zero hits for a `useCycle` definition). Delete-on-key is handled inline (`EditableCard.handleKeyDown`, `:789-798`, gated on `selected && !isFocused`).
- **Click-away** clears `transient` only (`EditorLayout.tsx:1473-1492`, `omni-host.tsx:204-206`); sticky survives. So selection is transient-clearable but expansion (sticky) is sticky until re-click — an asymmetry that becomes a feature once axes split (expanded cards stay open on click-away; halo clears).

### 1.8 The 2×2 as it actually behaves today

| | Not selected | Selected (halo + scroll) |
|---|---|---|
| **Collapsed** | initial / after close | (transient set but `transient∈expanded` ⇒ never stably collapsed-while-selected) |
| **Expanded** | sticky card after halo moves elsewhere (✓ reachable) | the default after any click or marker-select |

The bottom-right cell is the *only* one a single click can produce; the top-right cell (**selected-but-collapsed**) is **structurally unreachable** because `transient ⊂ expanded`. That unreachable cell is precisely what N1 demands (e.g. marker-select to scroll/halo without unfurling the body).

---

## 2. Warts / fragmentation / gaps catalog

### F1 — `toggleSelection` welds the two axes into one action *(the core bug)*
- **WHERE:** `anchored-card-store.ts:129-152`; consumed at ~12 card `onClick` sites (§1.2).
- **WHY wrong:** N1 ratifies expansion ⟂ selection. A single primitive that always mutates both makes the independent cells unreachable and forces every consumer to special-case (`if (!isExpanded(ref)) return;`). It is the root of F2/F3/F6.
- **DEEPEST fix:** replace with two orthogonal primitives on the store: `toggleExpanded(ref)` (mutates `stickySet` only — and only the expansion set; see F2) and `select(ref)` / `clearSelection()` (mutates a dedicated single `selected` slot only). The combined "open + focus" becomes an explicit *composition* (`select(ref); expand(ref)`) the body-click handler may choose to call — but the store no longer forces it.

### F2 — `transient` is a member of the expansion set ⇒ select auto-expands
- **WHERE:** `anchored-card-store.ts:73-76` (`isExpandedRef`), `:267-276` (`useIsExpanded`); the marker path `marker-clicks.ts:128/172/293` → `selections.tsx:74` `setTransient`.
- **WHY wrong:** A marker click intends select-and-scroll; because `transient ∈ expanded`, the card unfurls. Directly violates "selecting must NOT auto-expand."
- **DEEPEST fix:** introduce a **dedicated `selected: AnchoredCardRef | null` slot** (the halo/primary) that is *independent* of the expansion set. `expanded` becomes purely `stickySet` membership. `transient` is retired (its two jobs split: selection → the new `selected` slot; "ephemeral, clears on click-away" → a `sticky?: boolean` flag on expansion entries, or simply: selection is always transient-clearable, expansion is sticky). Marker clicks set `selected` only.

### F3 — No one-click EXPAND affordance (B1)
- **WHERE:** absence — no expand button anywhere; body-click is the only path (`NoteCard.tsx:111`, all cards). `Chevron` (`panel-primitives.tsx:1088`) is unused for this.
- **WHY wrong:** B1 requires expand to fire directly with no select step. Today expand is reachable only through the combined toggle.
- **DEEPEST fix:** render a one-click expand chevron in the unified header (left of the kind label, or as the kind-label affordance) wired to `toggleExpanded(ref)` — **selection untouched**. Emit `aria-expanded` on the card root (F9). One place: `PanelCard` unified header (`panel-primitives.tsx:1712-1739`), so all 13 cards get it for free.

### F4 — No one-click POP-OUT affordance on a docked card (B2 discoverability)
- **WHERE:** `panel-primitives.tsx:1734-1738` (popout/X button gated `&& isPoppedOut`); the only docked popout path is the drag-lift (`:1574-1692`).
- **WHY wrong:** B2 wants pop-out reachable without selection and without a drag. The lift gesture already satisfies *decoupling* but not *one-click discoverability*.
- **DEEPEST fix:** add a popout button to the docked unified header that calls the **same** handoff target as the lift — i.e. `popped.popOutAtRect(cardKey, <card rect>)` (or `toggleAtAnchor`), reusing the AF result path (Seam 1). Works on a collapsed card by construction (the gesture already does, §1.5). No selection, no expand required.

### F5 — Lift gesture's `isCollapsed`-disables-lift contract is dead/contradictory
- **WHERE:** prop doc `panel-primitives.tsx:1446-1448` ("lift-off drag is disabled (cards are only liftable when expanded)") vs actual guard `:1575-1578` (lift allowed collapsed). `isCollapsed` is passed (`:874`) but only used at `:1762` (trash gating).
- **WHY wrong:** stale, misleading contract; a future maintainer could "restore" the disable and break B2.
- **DEEPEST fix:** delete the stale prop-doc clause; rename/repurpose `isCollapsed` to its actual single use (trash-button suppression) or fold into `compressed`. (Coordinate with **A1 gardening** — this is dead-contract cleanup.)

### F6 — Every card re-implements the same conflated click handler (fan-out)
- **WHERE:** the 12 `onClick={ toggleSelection(...); if(!isExpanded) return; onSelect(...); onJump?.() }` blocks (§1.2).
- **WHY wrong:** the select/expand/jump policy is copy-pasted per card; changing the model means editing 12 files. Against the refactor's "unify scattered switches."
- **DEEPEST fix:** move the body-click policy into `useAnchoredCard` (return a single `onBodyClick` that composes the chosen primitives) or into `PanelCard`/`EditableCard` (a `onActivate` prop). Cards supply only their side effects (`onSelect`, `onJump`) declaratively. One policy site.

### F7 — `compressed` docstring encodes the abandoned "selection IS expansion" intent
- **WHERE:** `panel-primitives.tsx:692-693`.
- **WHY wrong:** documents `!selected` as the driver (consumers actually use `!expanded`); references a dead branch name. Misleads the N1 implementer.
- **DEEPEST fix:** rewrite the doc to state the post-A4 contract: `compressed = !expanded && !isPoppedOut`; expansion ⟂ selection; popped is always full.

### F8 — Roving tabindex is selection-keyed; no keyboard cursor
- **WHERE:** `panel-primitives.tsx:879` (`tabIndex={selected ? 0 : -1}`).
- **WHY wrong:** ties keyboard reachability to the halo, so you cannot Tab to an expanded-but-unselected card; no arrow roving within a list. Conflates "keyboard target" with "selected."
- **DEEPEST fix:** a roving-tabindex model where a panel-local *cursor* (independent of selection) sets `tabIndex=0` on the focused row and `-1` elsewhere; Arrow keys move the cursor (no select), Enter/Space *selects*, a separate key (e.g. `→`/`o`) *expands*. Selection remains the scroll/halo operand. This makes the 2×2 fully keyboard-operable. (Scope/ratification: §Open questions.)

### F9 — No `aria-expanded`; the expansion axis has no a11y surface
- **WHERE:** `useAnchoredCard.ts:72` emits `aria-selected` only; no `aria-expanded` on any card.
- **WHY wrong:** the 2×2 maps cleanly onto `aria-selected` (selection) × `aria-expanded` (expansion); emitting only one hides half the state from AT.
- **DEEPEST fix:** `useAnchoredCard` returns `aria-expanded={expanded}` alongside `aria-selected={selected || undefined}`; the expand control gets `aria-controls` → body id.

### F10 — `transient` does double duty (selection + "ephemeral, clears on click-away")
- **WHERE:** store semantics `anchored-card-store.ts:20-31`, click-away `EditorLayout.tsx:1486`, `omni-host.tsx:205`.
- **WHY wrong:** "is the halo" and "is the click-away-clearable slot" are two concerns fused into `transient`. Once selection gets its own slot, the click-away-clearable property belongs to *selection* (clears) while *expansion* stays sticky — but today both are entangled in `transient`'s membership.
- **DEEPEST fix:** after F2's split, selection is always transient/clearable; expansion entries are sticky. `markSticky` (`:157-173`, focus-promotion) becomes either obsolete (expansion already sticky) or repurposed to "expand on focus-into-body." Resolve in the target design.

### F11 — `ai`/`bib`/`error` live outside the axis model (inconsistent 2×2 coverage)
- **WHERE:** `selections.tsx:45-50`, `EditorLayout.tsx:1487-1488`, `ErrorCard.tsx:112` (`!selected` not `!expanded`).
- **WHY wrong:** three kinds have a bespoke `useState` selection and no `expanded` axis; their compressed/expand behavior diverges from the 13 anchored kinds. Cross-surface incoherence.
- **DEEPEST fix:** out of strict A4 scope (these are non-anchored), but the expand/select split should be expressed so non-anchored cards can opt into the *expansion* axis (a panel-local `expanded` set keyed by id) even without a doc anchor. At minimum, make `ErrorCard` gate on an `expanded` notion, not `selected`, for consistency. Flag for A10/A5 coordination.

---

## Target design — the deepest-fix shape

**Two truly independent axes in `anchored-card-store.ts`:**

```ts
interface CardInteractionState {
  expandedSet: AnchoredCardRef[];        // multi; sticky; "how much body shows"
  selected: AnchoredCardRef | null;      // ≤1; the halo / scroll / kbd-target / multi-op operand
  hover: AnchoredCardRef | null;
}
```

Primitives (each touches exactly ONE axis):
- `toggleExpanded(ref)` / `expand(ref)` / `collapse(ref)` — `expandedSet` only.
- `select(ref)` / `clearSelection()` — `selected` only. (Replaces `setTransient`; the per-kind slot setters in `selections.tsx` route here.)
- `setHover` — unchanged.

Derived hooks: `useIsExpanded(ref)` = `expandedSet` membership; `useIsSelected(ref)` = `selected` equality. **`transient` and `toggleSelection` are deleted.** Back-compat shims (`setSelection`, `markSticky`) are re-expressed against the new axes or removed.

**Body-click policy (one site, in `useAnchoredCard`/`PanelCard`):** a single `onActivate` that composes the ratified default (see Q1). Cards stop calling `toggleSelection`; they declare `onSelect`/`onJump` side effects.

**One-click controls in `PanelCard`'s unified header (all 13 cards inherit):**
- Expand chevron → `toggleExpanded(ref)` (no select). `aria-expanded` on the root.
- Popout button → `popped.popOutAtRect(cardKey, rect)` (no select, no expand-required), the SAME AF result path the lift gesture uses (Seam 1). Works collapsed.

**Marker clicks** (`marker-clicks.ts`) call `select(ref)` only — scroll/halo via `usePlacement`, **no expand**. This realizes the selected-but-collapsed cell.

**Keyboard (roving cursor, independent of selection):** panel-local cursor → `tabIndex`; Arrow moves cursor; Enter/Space selects; a dedicated key expands; popout via a key chord. (Pending Q3 scope.)

**How it consumes the foundations:**
- **AF:** pop-out routes through `usePoppedCards.popOutAtRect`/`toggleAtAnchor` → `FloatWindow`/`FloatChrome` exactly as today; A4 only adds a one-click *trigger* and guarantees it is selection/expansion-independent. No change to the float key grammar or `cardPopKey`/`cardDomSelector`.
- **A0:** the operand set derives from `isAnchoredCardKind`/`EntityKind`; the popout button's existence can be gated on `CARD_REGISTRY[kind].toFloatable != null` (poppability), so `error` (not poppable) correctly shows no popout control — registry-derived, no per-card switch.

**Registry-derived where possible:** interaction *state* is not card metadata (stays in the store), but *capabilities* (poppable? anchored? expandable?) read from `CARD_REGISTRY` predicates so no kind list is hand-maintained in A4 code.

---

## Keystroke sanctity

**No per-keystroke risk introduced, and none today.** The store is event-driven on user gestures (clicks/keys), not on editor transactions — `useSyncExternalStore` notifies only on `emit()` after a `select`/`expand`/`hover` write (`anchored-card-store.ts:55-57`). It is **not** an `editor.on('update')` subscriber and does no doc-walking. A4 touches **none** of the sanctioned `editor.on('update'|'transaction')` subscribers.

Two adjacent surfaces to keep clean during impl:
- `usePlacement` (`usePlacement.ts:76-151`) runs on **selection change**, not on keystrokes; its deps are `[selection, editor, collections]`. After the split it must fire on the new `selected` slot only — still O(1) per selection change, never per keystroke. Do **not** make it depend on `expandedSet` (that would re-scroll on expand, and expand could be triggered programmatically).
- Card-source memos (footnotes/citations/examples lists) are unaffected — they gate on `useStructuralRevisions` + reactive `editor` (AGENTS.md), and A4 does not derive card *data*, only interaction state. The expand/select split must not introduce a memo that re-walks the doc; the operand set is the already-derived card arrays.

Verify in dev preview: `window.__virgilBusStats().emitCount` stays flat while typing with cards expanded/selected/popped (the store writes don't touch the DocStructureBus).

---

## Fragmentation table

| Surface | File(s) (file:line) | Disposition |
|---|---|---|
| Combined select+expand primitive | `links/_shared/anchored-card-store.ts:129-152` (`toggleSelection`) | Split into `toggleExpanded` + `select` |
| `transient` ∈ expansion set | `anchored-card-store.ts:73-76, 267-276` | New `selected` slot; retire `transient`; `expanded`=`expandedSet` only |
| Per-card conflated click (×12) — `onClick={` opens, body calls `cardStore.toggleSelection(ac.ref)` | `Notes/NoteCard.tsx:111` (toggle :112), `Notes/HighlightCard.tsx:103` (:105), `Footnotes/FootnoteCard.tsx:127` (:128), `Citations/CitationCard.tsx:703` (:705), `Todo/TodoRow.tsx:138` (:140), `Archive/ArchiveCard.tsx:90` (:91), `Cutter/CutterCommentCard.tsx:112` (:114), `Cutter/CutterSuggestionCard.tsx:360` (:362), `Examples/ExampleCard.tsx` (toggle :118), `Reports/ReportCard.tsx:97` (:98), `Revisions/RevisionCommentCard.tsx` (toggle :124), `Revisions/RevisionSuggestionCard.tsx:273` (:275) | Centralize policy in `useAnchoredCard`/`PanelCard`; cards declare side effects only |
| `compressed` display gate | each card `const compressed = !isExpanded && !isPoppedOut` (e.g. `NoteCard.tsx:86`); outlier `Errors/ErrorCard.tsx:112` (`!selected`) | Keep `!expanded`; fix ErrorCard outlier; rewrite docstring `panel-primitives.tsx:692-693` |
| Expand affordance (B1) | absent; body-click only | Add one-click expand chevron in `PanelCard` unified header (`panel-primitives.tsx:1712-1739`) |
| Pop-out affordance (B2) | lift gesture `panel-primitives.tsx:1574-1692`; no docked button `:1734-1738` | Keep lift; add one-click docked popout button → `popped.popOutAtRect` |
| Stale `isCollapsed`-disables-lift contract | `panel-primitives.tsx:1446-1448` vs `:1575-1578` | Delete stale clause (A1) |
| Roving tabindex on selection | `panel-primitives.tsx:879` (`tabIndex={selected?0:-1}`) | Selection-independent roving cursor |
| a11y: `aria-selected` only | `useAnchoredCard.ts:72` | Add `aria-expanded` + `aria-controls` |
| Marker click select→expand | `marker-clicks.ts:127-131, 171-178, 291-310` → `selections.tsx:61-75` | Route to `select()` only; no expand |
| Scroll-on-select (selection axis ✓) | `usePlacement.ts:68-151` | Keep; rebind to new `selected` slot |
| Non-anchored kinds outside model | `selections.tsx:45-50`, `EditorLayout.tsx:1487-1488`, `ErrorCard.tsx:112` | Coordinate A5/A10; optional panel-local expand set |
| Click-away clears selection only | `EditorLayout.tsx:1473-1492`, `omni-host.tsx:204-206` | Keep (clears selection; expansion stays sticky) |
| Ghost `useCycle`/`PrevNextCounter` doc | `CardListPanel.tsx:6-7` | No `useCycle` exists; correct doc or wire real keyboard nav (A4 kbd) |

---

## Definition of Done for this arena

1. **Two independent axes** in `anchored-card-store.ts`: `expandedSet` (multi) and `selected` (≤1), with primitives that each mutate exactly one. `toggleSelection`/`transient` gone.
2. **B1:** a one-click expand/collapse control fires `toggleExpanded` with **zero** effect on selection (verified: expand a card, halo does not move; selected card collapses without losing halo).
3. **B2:** a one-click popout control (and the lift gesture) pop a card **without** selecting or expanding it, and **work on a collapsed card** (verified: pop a collapsed, unselected card → float appears; docked source unselected).
4. **Selecting ≠ expanding:** a marker click selects + scrolls + halos but **does not unfurl** the card (the selected-but-collapsed cell is reachable).
5. **All four 2×2 cells reachable in one gesture each**; popout independent of both.
6. **Policy centralized:** no card re-implements the select/expand click; the 12 sites collapse to declarative side-effect props.
7. **a11y:** `aria-selected` × `aria-expanded` both emitted; expand control labeled; popout independent of focus. Roving keyboard cursor decoupled from selection (or explicitly deferred with a ratified scope).
8. **Foundations honored:** popout uses AF's `popOutAtRect`/`FloatChrome` result path; poppability gated on `CARD_REGISTRY` (error shows no popout). No text-object code touched except via the shared float layer.
9. **Keystroke sanctity:** `__virgilBusStats().emitCount` flat on typing with cards expanded/selected/popped.
10. **No regression** to scroll-on-select, click-away clear, collab claim/presence, or the lift handoff continuity.

---

## Open questions for the human

- **Q1 (body-click default policy).** When the user clicks a card *body* (not the expand chevron, not the popout button), what should happen? Options: (a) **select + expand** (closest to today, discoverable); (b) **select only** (expand stays a separate one-click — purest N1); (c) **expand only** (select stays separate). Recommendation: **(a)** as the default *composition*, with the chevron/popout giving axis-pure overrides — but this needs ratification since it determines whether the selected-but-collapsed cell is the *default* or an *opt-in*.
- **Q2 (multi-select operand).** N1 names "multi-select operand" as a selection property, but the store today has a single `selected` (primary). Do we need a genuine multi-*selection* set (distinct from the multi-*expansion* set), or is multi-expand sufficient and "selection" stays single? If multi-select is wanted (e.g. bulk archive/delete), it needs its own set + gesture (Cmd/Shift-click) — a meaningful scope expansion. Recommendation: keep selection single for A4; defer multi-select to a follow-up unless you want it now.
- **Q3 (keyboard nav scope).** Is a full roving-tabindex keyboard model (Arrow to move cursor, Enter to select, key to expand, chord to pop out) in scope for A4, or is the deliverable just "split the axes + one-click controls + a11y attributes," with keyboard nav as a fast-follow? Today there is *no* card keyboard cursor at all, so this is net-new work.
- **Q4 (does a popout auto-select?).** When a card is popped out, should it become selected (halo its anchor) or stay unselected? Today the lift doesn't select; AF floats can be selected via their body. Confirm: **pop-out is axis-pure (no auto-select)** — assumed yes per B2's "pop-out without selecting."
- **Q5 (non-anchored cards).** Should `bib`/`ai`/`error` gain a real `expanded` axis (panel-local set) for cross-surface consistency, or stay on their bespoke `useState` (out of A4 scope)? Affects F11/ErrorCard outlier.

---

## Cross-arena seams

- **AF (Floatable presence) — `panel-primitives.tsx:1574-1692` (lift), `usePoppedCards.ts:25-49`, `FloatChrome.tsx`, `cards/floats/index.tsx`.** A4's one-click popout reuses AF's `popOutAtRect`/`toggleAtAnchor` result path (Seam 1: domain owns the birth trigger, subsystem owns the float). A4 must not duplicate float logic; it only adds a selection/expansion-independent trigger. The expand chevron must NOT collide with AF's reserved `FloatChrome` **title slot** (the A9 morph chevron) — A4's expand control is a *docked-header* affordance; popped cards are always full-body, so no expand control in `FloatChrome`.
- **A9 (appearance & typography) — `panel-primitives.tsx:1712-1739` (unified header), `cards/floats/index.tsx:406-414, 441-449` (morph dropdown in `chromeSlots.title`).** A4 adds the expand chevron to the same unified header where A9 mounts the morph chevron. Two chevrons in one header — coordinate placement/precedence (expand vs morph) and the compressed-body display class (A9's C1 "borrows-from-main-text" must render correctly in the *expanded* state A4 controls).
- **A5 (omni-view) — `omni-host.tsx:204-211` (`setTransient(null)`/`markSticky`), `Omni/OmniViewPanel.tsx`, each panel's `omni.tsx`.** Omni shares the same `cardStore` axes; the split must apply identically docked and in omni. A5's unanchored-card reflow depends on expansion behavior settling here (explicit dependency in SSOT §7 A5). Omni's `markSticky`-on-focus (`omni-host.tsx:209-210`) is the F10 surface to resolve jointly.
- **A2 (anchoring & link model) — `anchored-card-store.ts:36` (`AnchoredCardRef.kind: EntityKind`), `entity-hover.ts:22-38` (`ANCHORED_CARD_KINDS`), `useAnchorHighlightReconciler.ts:173-179` (clears selection/sticky for vanished entities).** The store is typed on `EntityKind`; A2's open question (is `EntityKind` redundant with the registry `anchored` flag?) directly affects A4's operand typing. The three-surface highlight (text+margin+card) A2 owns is driven by A4's *selection* axis — shared SSOT.
- **A6 (marginalia gutter) — `Marginalia.tsx` (uses `useIsExpanded`/selection), `marker-clicks.ts`.** Marginalia markers are a *selection* surface (click → `select`, hover → `setHover`); A4's "marker click selects, not expands" change lands partly here. The gutter must reflect the *selection* axis (halo), and optionally the *expansion* axis as a distinct marker state.
- **A3 (creation & lifecycle) — `usePristineCardManager`, `focus-new-card.ts`.** A freshly-created card today is selected+expanded (via the slot setter → transient). After the split, creation should `select` + `expand` explicitly (a new card wants both); A3's pristine-discard interacts with the selection axis (a pristine card loses selection on click-away). Shared: the "new card is focused" contract.
- **A1 (gardening) — `panel-primitives.tsx:1446-1448` (stale `isCollapsed` lift contract), `CardListPanel.tsx:6-7` (ghost `useCycle` doc).** F5/F8 dead-contract cleanup belongs to or coordinates with A1.

---

## Stale-ref corrections

- **SSOT §7 A4 "Files: `anchored-card-store.ts`, `CardListPanel.tsx`."** Accurate but incomplete — the conflation's real centers are `anchored-card-store.ts:129-152` (store) + the ~12 per-card `onClick` sites + `panel-primitives.tsx` (`EditableCard`/`PanelCard`, the unified header + lift gesture). `CardListPanel.tsx` is a thin list wrapper that does **not** own selection/expansion (its docstring `:5-11` explicitly disclaims keyboard/selection ownership); the operative file is `panel-primitives.tsx`.
- **SSOT §3 / cheat-sheet "`FloatCard` (`FloatingCards.tsx`) … `TextObjectFloat.tsx`."** STALE — both deleted by AF (Session 10). Float window is now `src/floats/FloatWindow.tsx` + `FloatChrome.tsx` + `FloatHost.tsx`; the lift handoff is `src/components/card-lift.ts`; popped-state context is `src/hooks/usePoppedCards.ts`.
- **`usePoppedCards.ts:14-16` docstring "Card keys are shaped `${kind}:${id}`."** STALE — post-AF the canonical key is `float:card:<kind>:<id>` via `cardPopKey`/`buildFloatKey` (Session 9). The doc-comment predates the grammar flip. (Backlog item; flagged here for A1.)
- **`panel-primitives.tsx:692-693` `compressed` docstring "Driven by `!selected`… Selection is the expansion mechanism."** STALE/contradicted — consumers gate on `!isExpanded` (the multi-card axis), not `!selected`; the "selection IS expansion" framing is the pre-N1 intent A4 retires. Also references a dead branch name ("i-want-to-introduce-iridescent-spark").
- **`panel-primitives.tsx:1446-1448` `isCollapsed` prop doc "lift-off drag is disabled (cards are only liftable when expanded)."** STALE/contradicted by the actual guard at `:1575-1578` (lift allowed in both states). `isCollapsed`'s only live use is the trash-button gate at `:1762`.
- **`CardListPanel.tsx:6-7` "(`useCycle` + `PrevNextCounter` are passed via `headerExtras`)."** STALE — no `useCycle` module exists in `src/` (grep: zero definition hits). The reference is to a removed/never-landed helper.
- **`anchored-card-store.ts` two-slot model vs SSOT "Sticky/transient selection model."** The SSOT phrasing (`sticky`/`transient`) matches the *current* store, but N1's target retires `transient` in favor of an independent `selected` slot — so the SSOT's "Sticky/transient" line describes the *as-is*, not the *to-be*; the impl chip should not preserve `transient` verbatim.
