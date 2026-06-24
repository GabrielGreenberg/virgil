# FEATURE — On card creation, drop the cursor into the card body (auto-select + auto-focus), for every input-requiring kind

**Status:** `PLAN-READY` (the focus seam already exists; the fix is small + central) · 2 design decisions flagged
**Filed by:** bug-catcher session, 2026-06-21
**Repo note:** diagnosis only (no source edits); unrelated to the `keep-alive` worktree.

---

## 1. Request

For every card-creation that requires text input (note, footnote, suggest-edit, todo, report, comment…), creating the
card should auto-**select** it **and** move the cursor straight into its body, writable. E.g. `\footnote` + Return →
the next keystrokes land in the footnote body. The user explicitly wants the **deep/central** fix covering all kinds.

---

## 2. The key finding — the focus helper already exists; it's just not wired centrally

There is a complete, robust, per-kind-aware helper that does exactly the hard part:

**`focusNewCard(cardKey)`** ([focus-new-card.ts:15-72](src/lib/focus-new-card.ts:15)):
- Retries across up to 12 frames (double-rAF) → survives the async card mount (RichTextField is `immediatelyRender:false`).
- `pickFocusTarget(card, kind)` ([:77-125](src/lib/focus-new-card.ts:77)) dispatches **by kind** to the right editable —
  `[contenteditable]` for note/footnote/archive/report, `<textarea>` for cutter/revision comment+suggestion,
  `<input>` for todo, the library input for citation. **This already handles all the body-type variance.**
- Focuses with `preventScroll:true` and **drops the caret at the end** (contenteditable range-collapse, or
  textarea/input `setSelectionRange(end)`).

So the "how do I land the cursor in a just-created body of varying type, mounting async" problem is **already solved**.

### Why it doesn't happen today (two gaps)
1. **Not called from the central chokepoint.** `finishCreate` ([card-creation.ts:362-388](src/components/editor-layout/card-actions/card-creation.ts:362)) —
   the shared tail **every** create path funnels through — calls `suppressNextPlacement()` + `setSelected(id)` (→
   `cardStore.select`) + `pin` + panel/float surface, but **never calls `focusNewCard`**. So the cursor stays in the
   main editor. `focusNewCard` is instead wired into only a couple of *individual* paths (the drag-handle dispatcher and
   the `\cite` command-input bridge, per its docstring) — scattered, not universal.
2. **`finishCreate` deliberately never expands.** Its docstring: *"select the new card … `cardStore.select({kind,id})`
   only, **NEVER expand**".* Selection ≠ expansion — they're orthogonal axes (`ac.selected` vs `ac.expanded`,
   [useAnchoredCard]). A freshly-created card in a docked panel / omni margin renders **compressed**, so its
   RichTextField body **isn't mounted** — `focusNewCard` would retry 12 frames and find nothing. (Floats are exempt —
   a popped float shows the card expanded, so the toolbar/float path already works if focus is called.)

### Two kinds already hand-roll this (the workaround the central fix subsumes)
`CutterCommentCard` and `RevisionCommentCard` have a per-kind `useEffect` that focuses the body when selected+empty
([CutterCommentCard.tsx:94-100](src/panels/Cutter/CutterCommentCard.tsx:94), [RevisionCommentCard.tsx:82-89](src/panels/Revisions/RevisionCommentCard.tsx:82)) —
exactly the behavior wanted, done locally for two kinds. The central fix replaces these.

---

## 3. Verified: all creation paths funnel through `finishCreate`
Toolbar/“+”, drag-handle menu, slash `\footnote`/`\cite`, typed `\footnote{}`/`\cite{}` input-rules, citation popover
commit — **all** route create*→`finishCreate` (slash/typed go via the editor-actions bridge → `action-registry`
`footnoteRun`/`citationRun` → `createFootnote`/`createCitation` → `finishCreate`). So one call site covers everything.

---

## 4. Deep fix — call the existing helper at the one chokepoint (+ expand + gate)

In **`finishCreate`** ([card-creation.ts:362-388](src/components/editor-layout/card-actions/card-creation.ts:362)),
after `setSelected(id)`:

1. **Expand the new card so its body mounts** (creation-specific). `cardStore.expand({kind, id})` for kinds with an
   editable body. **This reconciles the "NEVER expand" invariant for the *creation* case only** — that rule is about
   *selecting an existing* card not auto-expanding (selection = halo); *creating* a card the user wants to write in is a
   different intent. (Float path already shows it expanded → expand is a no-op/safe there.)
2. **`focusNewCard(cardPopKey(kind, id))`** — the existing helper drops the caret into the body. It is **self-gating by
   kind**: `pickFocusTarget` returns `null` for bodiless kinds (highlight) → harmless no-op, so no per-kind allow-list is
   strictly needed for the focus call (gate the *expand* on an editable-body predicate to avoid expanding bodiless cards
   — e.g. extend `@/cards/has-content.ts` / a `hasEditableBody(kind)` registry predicate).
3. **Gate on user-initiated creation.** Thread an `autoFocus` (a.k.a. `userInitiated`) flag through the create opts:
   interactive paths (toolbar/slash/typed/drag-handle) pass `true`; the **AI-request bridge / programmatic** creates pass
   `false` so they don't yank focus while the user is doing something else. `finishCreate` skips expand+focus when false.
4. **Consolidate.** Remove the now-redundant scattered `focusNewCard` calls (drag-handle dispatcher, `\cite`
   command-input bridge) and the hand-rolled Cutter/Revision focus-on-select effects — all subsumed by the central call.
5. **(Robustness) pick the visible instance.** A card can render in the docked panel *and* the omni margin; `focusNewCard`
   currently `querySelector`s the first `[data-card-key]` in DOM order. Switch to `querySelectorAll` + first
   `offsetParent != null` (the `usePlacement.ts:111-119` pattern) so it focuses the *visible* instance, not a compressed
   one. Small enhancement inside `focusNewCard`.

### Why this is the deepest *and* smallest fix
The investigation's alternative was a new `usePendingCardBodyFocus` React handoff touching every body component and
**re-deriving the per-kind body-type dispatch that `focusNewCard` already has**. Reject that: it duplicates a solved
problem. Reusing the existing complete helper at the single `finishCreate` chokepoint is one call site (+ expand + a
flag) and naturally covers every kind and path. Keep `focusNewCard` as the SSOT for "caret into a card body."

---

## 5. Kinds (self-gating)
Focus applies wherever `pickFocusTarget` finds a target: **note, footnote, archive, report, report-request** (rich body),
**cutter-comment/-suggestion, revision-comment/-suggestion** (textarea), **todo** (input). **Excluded naturally:**
highlight (no body → null). **Citation:** `pickFocusTarget` targets its library input — decide whether create-citation
should focus that (its popover/picker may already own focus); the user's list (note/footnote/suggest-edit) doesn't require
it, so default to letting the citation popover keep its own focus and not expand/focus the citation card.

---

## 6. Design decisions (flag)
1. **Expand-on-create (reconciling the A4 "never expand" rule).** Required to mount the body so the cursor can land —
   the user's request directly motivates it. Confirm there's no reason A4 must hold for *creation* (it's about
   selection of existing cards). **Recommend: expand on user-initiated create for editable-body kinds.**
2. **AI-request gating.** Where does programmatic/AI creation call `createX`? Thread `autoFocus:false` there. Find the
   AI-request bridge create sites and the `aiRequest`-flagged note/todo/footnote creation.

## 7. Risk / tests
- **Steal-focus race:** focus must fire *after* `finishCreate` returns + the body mounts — `focusNewCard`'s double-rAF +
  retry already defers past the React commit; `suppressNextPlacement` keeps the editor from scrolling. Verify a real
  `\footnote`+Return lands the next keystroke in the footnote (the canonical case) and that typing mid-sentence then
  creating doesn't drop a stray keystroke into the main text.
- **Collab-claimed cards:** if a card is claimed (editable=false), `pickFocusTarget` finds a non-editable / no
  contenteditable → no-op; confirm it doesn't focus a disabled body. Add an `editable` bail if needed.
- **Keystroke sanctity:** one focus call per creation, none per keystroke; the expand is a single store write. No
  per-keystroke work.
- **Tests:** per-kind "create → caret is in the body at end" (note/footnote/todo/cutter-comment/revision-suggestion);
  AI-request create does NOT focus; highlight create is a no-op; multi-surface picks the visible instance.

## 8. Files
- [src/lib/focus-new-card.ts](src/lib/focus-new-card.ts) (the SSOT helper; add visible-instance pick) ·
  [src/components/editor-layout/card-actions/card-creation.ts:362-388](src/components/editor-layout/card-actions/card-creation.ts:362)
  (call it + expand + thread `autoFocus`).
- Remove redundant callers: the drag-handle dispatcher + the `\cite` command-input bridge + the hand-rolled focus in
  [CutterCommentCard.tsx:94-100](src/panels/Cutter/CutterCommentCard.tsx:94) / [RevisionCommentCard.tsx:82-89](src/panels/Revisions/RevisionCommentCard.tsx:82).
- AI-request create sites (thread `autoFocus:false`) — grep the AI-request bridge + `aiRequest` create paths.
- [src/links/_shared/anchored-card-store.ts](src/links/_shared/anchored-card-store.ts) (`cardStore.expand`) ·
  `@/cards/has-content.ts` (editable-body predicate).

## 9. Open questions
1. Does the `\footnote`+Return path surface the footnote card *expanded* anywhere already, or is expand-on-create
   strictly required there? (Likely required — verify the footnote card's compressed default in the panel/omni.)
2. Should create-citation focus its library input, or leave the citation popover to own focus? (Recommend the latter.)
3. Where exactly is the AI-request/programmatic create boundary to pass `autoFocus:false`?
