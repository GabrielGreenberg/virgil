# Bug: clicking a panel card (e.g. a footnote-nested cite) yanks the document to its anchor

**Status:** `ROOT-CAUSE-FOUND` / `DESIGN-READY` — diagnosis only, NOT implemented. **Carries a PRODUCT DECISION (see "The fork").** Bug-catcher session 2026-06-25; investigate→adversarial-verify workflow.
**Confidence:** HIGH on the mechanism + enumeration (all confirmed against code). The fix is a deliberate reversal of a *tested, ratified contract* — needs sign-off, not a silent patch.
**Worktree:** TBD (touches the shared card-activation hook + every panel card).

---

## Request (user)

> "A footnote and its sub-cite card: if you CLICK the citation card, it triggers a JUMP to the position of the FOOTNOTE. This is distracting. Consider whether there are OTHER similar jump situations that need addressing."

---

## Root cause: select and navigate are FUSED on a plain body-click

There is ONE shared coupling point. `useAnchoredCard.onBodyActivate` ([useAnchoredCard.ts:105-114](src/links/_shared/useAnchoredCard.ts:105)) does, on a plain card-body click:
```
wasSelected = cardStore.isSelected(ref)
cardStore.select(ref); cardStore.expand(ref)
effects.onSelect()
if (!wasSelected) effects.jump()      // <-- scroll fires on the FIRST select
```
Every anchored card body passes `jump:` into this (e.g. [CitationCard.tsx:771-780](src/panels/Citations/CitationCard.tsx:771): `jump: isAnchored ? () => onJump(card) : undefined`). So **clicking a card to select/inspect it also scrolls the document to its anchor.** (Re-clicking an already-selected card does not re-jump — `wasSelected` gate, FN-F2-01 — but the first jump is the distracting one.)

**Why the nested cite jumps to the footnote (correct target, wrong trigger):** a footnote-nested `\cite` is a JSONContent literal inside the footnote node's `attrs.content`, with **no own PM node and no own DOM**. `findInlineAtomPosDeep` ([inline-content.ts:347-397](src/lib/inline-content.ts:347)) misses it at top level, descends into the footnote body, and returns `{pos: hostFootnotePos, nested:true, hostFootnoteId}`; `resolveLink` re-targets the DOM query to the host footnote superscript ([links.ts:499-506](src/links/links.ts:499)). The cite's own `pos` field *is* the host footnote position by design ([doc-structure/types.ts:56-60](src/lib/tiptap/doc-structure/types.ts:56)). So the footnote marker **is** the right target — the fault is that the jump fires on mere selection, not that it lands wrong. (The alt hypothesis "child inherits parent anchor in the nesting layer" is REFUTED — nesting only controls visual indent/order.)

Then `jumpToLink` → `alignEntryToY` ([layout-scroll.ts:60-75](src/components/editor-layout/layout-scroll.ts:60)) sets `scrollTop` so the marker aligns to the card's Y **even if the marker was already on screen**, and dispatches `virgil-card-jumped` (pinTop) so the card stays pinned while the document yanks under it. That viewport motion is the distraction.

---

## Other jump situations (the cluster — user asked for this)

**Every anchored card kind has the same select→scroll coupling** via the one hook. Confirmed callers (drop `jump:` from each):

| Surface | Kind | Behavior |
|---|---|---|
| Citations (docked + omni) | citation incl. footnote/example-nested children | **the reported bug**; nested → host marker |
| Footnotes | footnote | scrolls to superscript marker |
| Notes / floats | note / highlight | scrolls to anchored paragraph (if linked) |
| Todos | todo | → paragraph |
| Reports | report / report-request | → paragraph |
| Cutter | cutter-comment / -suggestion | → paragraph |
| Revisions | revision-comment / -suggestion | → paragraph |
| Examples | example | → example block |
| Archive | archive | → origin paragraph |
| **Bibliography** | bib | **EXCEPTION — select does NOT scroll; jump is a SEPARATE `TargetIcon` button** ([BibliographyPanel.tsx:1028-1032](src/panels/Bibliography/BibliographyPanel.tsx:1028)) — the "good" decoupled pattern to generalize toward |
| Errors | error | explicit `onJump`, not anchor-coupled |

**Paths that ALSO scroll-on-activate but must be LEFT INTACT** (they are explicit navigate gestures, NOT body-select; an implementer chasing "all select→scroll" must not rip these out):
- Keyboard cycle: `FootnotePanel` `onActivateItem` ([:90-96](src/panels/Footnotes/FootnotePanel.tsx:90)), `CitationsPanel` `onActivateCitation` ([:189-200](src/panels/Citations/CitationsPanel.tsx:189)) — scroll directly, bypassing `onBodyActivate`.
- Float-card `jumpToSource` menu action ([cards/floats/index.tsx](src/cards/floats/index.tsx)).

UNAFFECTED by the fix (don't route through `onBodyActivate`): outline section-click (`scrollHeadingToActiveLine`), marginalia marker click (text→card, inverse direction), cross-panel search `openItemInPanel` (selects + docks, already no scroll).

---

## The fork (PRODUCT DECISION for Gabriel)

The select→jump coupling is a **deliberate, documented, TESTED contract** (C15; [useAnchoredCard.ts:31-71](src/links/_shared/useAnchoredCard.ts:31); asserted by [body-activate-composition.test.tsx:29-77](src/links/_shared/__tests__/body-activate-composition.test.tsx:29) — "first click selects + expands + jumps"). Changing it is a UX reversal, not a bugfix — so it's a choice:

- **(a) Full decouple (RECOMMENDED — deepest/unified, matches the central design principle).** Remove `jump` from `onBodyActivate` — selecting never moves the viewport — and **promote the jump affordance (`CardJumpChevron`, currently popout-only, [panel-primitives.tsx:495](src/components/panel-primitives.tsx:495)) to the docked + omni header**, mirroring Bib's always-present `TargetIcon`. One hook edit kills the distraction for the *whole cluster* and converges every panel on the bib pattern — finishing the axis-separation the hook already declares (selection ⟂ expansion ⟂ **navigation**). **Mandatory companion (load-bearing, not optional):** the chevron promotion MUST ship in the same change, or docked/omni surfaces lose ALL one-click navigation.
- **(c) Off-screen-only (lighter alternative).** Keep click-to-jump, but gate it in `onBodyActivate` to scroll only when the resolved marker is outside the viewport — killing the most-distracting case (re-aligning an *already-visible* marker, which `alignEntryToY` does today). Smaller behavior change; preserves the convenience. Needs a viewport-intersection read at click time, scoped to the active pane (couples to the multi-pane fix below).
- (b) "Smarter nested target" — REJECTED: the target is already correct; this misreads the fault.

My recommendation given Gabriel's stated preference for deep solutions capturing a cluster: **(a) + the pane-scope fix below**. But (c) is the better call if he values one-click navigation — present both.

---

## ⚠️ Independent latent bug surfaced (deep-unified opportunity): wrong-pane scroll under keep-alive

`findRowScroll()` does `document.querySelector('[data-virgil-row-scroll]')` ([layout-scroll.ts:46](src/components/editor-layout/layout-scroll.ts:46)) = the FIRST in DOM order. Under multi-doc keep-alive there are **N** such rows (hidden panes are `display:none`, not unmounted — [KeepAliveSlot.tsx:28](src/lib/keep-alive/KeepAliveSlot.tsx:28)), so any jump can scroll the **wrong / hidden** pane; the closure-captured editor's marker `getBoundingClientRect().top` is also `0` when `display:none`. This is **orthogonal to the select decouple** — it affects every retained jump caller (the promoted chevron, the bib `TargetIcon`, the keyboard cycle, float `jumpToSource`). The deep-unified fix Gabriel would want: a **single pane-scoped row resolver SSOT** (prefer a `[data-virgil-row-scroll]` whose `offsetParent !== null` / inside the visible slot, or thread the active editor's `view.dom` and `closest()`). Fix this regardless of the (a)/(c) choice. (Same class as the `\ex` multi-pane bug in [MEMO_VIRGIL_CMD_BRIDGE_MULTIPANE.md](MEMO_VIRGIL_CMD_BRIDGE_MULTIPANE.md) — "exactly one X mounted" assumptions broken by keep-alive.)

---

## Files to change (Option a) + tests

- [useAnchoredCard.ts:105-114](src/links/_shared/useAnchoredCard.ts:105) — stop calling `effects.jump()` on select; update C15/N1 doc to declare navigation a third axis.
- [panel-primitives.tsx:495](src/components/panel-primitives.tsx:495) — promote `CardJumpChevron` to docked + omni when `canJump` (drop popout-only gate); thread `onJump` in `PanelCard` chrome (~:1099).
- Drop the `jump:` arg in all 13 body callers (Citation/Footnote/Note/Highlight/Todo/Report/ReportRequest/CutterComment/CutterSuggestion/RevisionComment/RevisionSuggestion/Example/Archive cards) — `onJump` now drives only the chevron.
- [layout-scroll.ts:46](src/components/editor-layout/layout-scroll.ts:46) — pane-scope `findRowScroll` (the latent multi-pane fix; applies to (c) too).
- **Tests:** rewrite `body-activate-composition.test.tsx` (first-click does NOT jump); keep `findInlineAtomPosDeep` nested-resolution test (target unchanged); add body-click-doesn't-scroll-but-chevron-does; keyboard cycle STILL scrolls; multi-pane guard (scroll on a hidden pane doesn't move the visible row).

## Repro
Open annotation-history; find a footnote whose body contains a `\cite` (nested cite); scroll so the footnote marker is off-center; single-click the nested citation card body (not the chevron) → the document yanks so the footnote marker re-aligns to the card's Y, though you only meant to select. Re-click → no second jump (confirms select-coupling).
