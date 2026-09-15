<!-- last-verified: 3a8f4892 2026-09-15 -->
<!-- derives-from: AGENTS.md#laws -->

# A preservation guard may not restore the removal itself

> **A guard that reverts a user's removal must never leave the document
> BYTE-IDENTICAL.** Where its remedy reproduces exactly what vanished, the guard
> has preserved nothing — it has VETOED the gesture, silently, permanently, with no
> feedback and no user-reachable escape. Ask the literal question
> (`removed.eq(replacement)`) rather than a proxy for it, and fail OPEN.

This is the "Backspace does NOTHING and only the grab-handle delete works" class
(task 367), and its lesson is that the defect lived in a guard whose *contract* was
right and whose *implementation of the exception* was one caller's meta.
`MarginaliaAnchorGuard` ([linked-anchor.ts](../../../src/lib/tiptap/linked-anchor.ts))
re-inserts `paragraph({ uuid })` when an anchored uuid-bearing block vanishes, so a
card's Mode-A anchor survives an incidental edit — correct, and load-bearing. Its
one exception, `LIFECYCLE_DELETE_META`, is spelled by exactly two callers (the
grab-handle Archive / Delete actions). So the contract reads *incidental vs
deliberate* and the code reads *grab-handle vs everything else*, and a Backspace
aimed squarely at a block is classified incidental.

That is invisible for a NON-empty block (the remedy drops the content, so the
gesture visibly did something). It is total for an EMPTY uuid-only paragraph: the
remedy IS the removed node, so the document is byte-identical and the key is dead
for every press, forever. And those husks are the guard's own output — a block the
guard resurrected once is an invisible, undeletable husk from then on. A stray
`%!v:XXXX` anchor line in the `.tex` parses to exactly this node, which is how
Gabriel met it twice in one paper.

Four rules it earned:

- **The predicate IS the law.** `removed.eq(paraType.create({ uuid }))` asks
  "would re-inserting reproduce what vanished?" — type, attrs, marks and content in
  one call. No hand-listed conditions, and it follows automatically if the remedy's
  shape ever changes. An empty paragraph carrying a `parTitle` is correctly NOT this
  case: the title is visible, so dropping it changes the document.
- **Fail OPEN, and re-check the identity to make that honest.** A position that
  reads back as nothing, or as a node whose uuid doesn't match, resurrects — a
  needless resurrection is the status quo, while a wrong stand-down orphans a card.
  Without the uuid re-check a stale position would silently compare the WRONG node.
- **Standing down is not data loss, because the sweep was already correct.**
  `TextObjectOrphanGuard` re-reads the SETTLED doc in its deferred pass, so a block
  this guard declined to resurrect is genuinely gone and its event fires: the card
  lands in the orphan strip, re-pinnable — precisely the outcome the one
  user-reachable deletion path already produces for the same block.
- **The isolating-boundary hypothesis was FALSIFIED and is pinned as such.** The
  filed diagnosis blamed PM's `findCutBefore` refusing to cross `isolating`, so that
  both `joinBackward` and `selectNodeBackward` return false. Measured against the
  real stack, `selectNodeBackward` node-selects an isolating sibling perfectly well
  and the two-press select-then-delete affordance works at every isolating edge — so
  no shared boundary handler was added, and a suite leg keeps that from being
  "fixed" again. *Verify a phenomenon is general before generalizing the fix.*

**Decided, with its evidence:** a comment line that is only an anchor KEEPS minting
its empty block. The uuid is a card's anchor identity, so dropping it at parse time
would orphan the card on every load with no user gesture at all — strictly worse
than the husk, which is now deletable.

**The premise is confirmed against the reporting paper, not only reproduced
synthetically.** Both reported uuids are live Mode-A anchors in that paper's
`virgil/revisions.json` — `3be5` on one revision card, `c194` on two — which is
exactly the condition this guard fires on. Two details corroborate the fix's
outcome. The husks themselves are now GONE from that `.tex` while those cards still
name them, i.e. Gabriel already removed them the only way that worked (grab-handle
Delete) and already accepted the orphaning this fix produces. And the THREE husks
live in it today (`2d33`, `4a3b`, `f0c5`) are named by no sidecar at all — so they
were always deletable, which is why the defect reads as intermittent: whether the
key works depends on whether a card happens to anchor that husk.

CI: [anchored-empty-block-keyboard-delete.test.ts](../../../src/lib/tiptap/__tests__/anchored-empty-block-keyboard-delete.test.ts).
Every leg drives `view.someProp("handleKeyDown", …)` on the REAL
`buildEditorExtensions("main")` stack, and that is the whole point — the
pre-existing [anchored-block-delete-reinsert.test.ts](../../../src/lib/tiptap/__tests__/anchored-block-delete-reinsert.test.ts)
characterizes this guard thoroughly by dispatching `tr.delete` DIRECTLY, where the
remedy is a real change and the defect is **unrepresentable**. It only appears when a
real keystroke removes a block that was already the husk. Measured by neutering the
predicate: 5 defect legs fail, the 7 control and non-regression legs pass either way.

**Owed, not claimed:** a real-FSA eyeball on Gabriel's own `.tex` geography — this
class is FSA-masked (the husks come from a paper's stray anchors), so the durable
proof here is the unit contract.

### The scope half: a question about a CONTAINER is not answered inside a LEAF

Same key, one container over (task 418) — and the case where ONE keymap's two
halves asked the same question from two different scopes, and only the half with
the wrong scope was destructive.

Gabriel, from a real paper: *"if i try to delete the line after 'spatial
relations to the self' it breaks the list. in general there are a lot of issues
with deleting empty lines under lists."* The shape on screen is a list item with
TWO children — `listItem(paragraph("Spatial relations to the self"),
paragraph(""))` — which Virgil's `listItem` content model
(`(paragraph | graphicsBlock) block*`) makes first-class and which arrives **from
ordinary `.tex` with no user gesture**: task 348's `tailSep` rule exists precisely
for a second paragraph in an item, and a stray anchor-only line parses into one
(the task-367 husk class). Upstream TipTap users rarely have multi-paragraph list
items; academic papers do.

Virgil disables StarterKit's `bulletList` / `orderedList` / `listItem` and ships
its own, and it did **not** disable `listKeymap` — so TipTap's `ListKeymap` owned
Backspace and Delete around lists. Its two halves:

- `Delete` → `isAtEndOfNode(state, "listItem")`, which resolves the ENCLOSING
  ITEM and compares `$anchor.pos + 1` against **its** content end. Item-scoped.
  Correct.
- `Backspace` → `isAtStartOfNode(state)`, which compares `$from.parentOffset` —
  the offset inside the **TEXTBLOCK**. A caret at the start of *any* block in the
  item satisfies it.

So Backspace on the empty line took the item-start branch and **destroyed the
item**. The keystroke costs IDENTITY: the merged or lifted item's `uuid` dies, so
every card, marginalia marker and sidecar `parTitle` keyed on it orphans — from a
press the user believes deletes a blank line.

> **A question about a CONTAINER is answered from the container's own boundaries,
> never from an offset inside a LEAF.** `atListItemStart`
> ([list-keymap.ts](../../../src/lib/tiptap/list-keymap.ts)) is the missing twin of
> upstream's item-scoped `isAtEndOfNode(state, name)` — the exact mirror of its
> arithmetic — and `VirgilListKeymap` GATES the key on it before DELEGATING to
> upstream's own `listHelpers.handleBackspace` / `handleDelete`.

Six rules it earned:

- **Delegate; do not vendor.** `@tiptap/extension-list` exports its `listHelpers`
  namespace, so the replacement carries no copy of upstream's branch logic to
  track — the only Virgil code is the gate. That is strictly better than both
  obvious shapes: a higher-priority SHADOW cannot stop `ListKeymap` from running
  when it declines (a handler returning `false` does not block the next one), and
  a vendored ~80-line fork buys a maintenance debt for logic that was never
  wrong.
- **A declined press must cost NOTHING.** The gate `continue`s rather than
  returning true, so every later Backspace owner still runs and the key falls
  through to TipTap's core chain (`undoInputRule` → `deleteSelection` →
  `joinBackward` → `selectNodeBackward`) — plain ProseMirror, which merges the
  block into the one above it *inside the same item*. That fall-through is also
  why the gate needs no `undoInputRule` of its own.
- **Gate the START only; the END half was already right.** Re-deriving an
  item-scoped `atListItemEnd` would have been a FORK of a correct upstream helper
  — this file's own recurring finding, arriving as a tidy-up. The suite asserts
  the SYMMETRY instead (both halves answer `false` at a later block's boundary),
  which is the "two halves, one rule" contract stated as a claim rather than as a
  second implementation.
- **…and the leg that states it needs a NON-EMPTY later block.** In an empty
  paragraph the block's start and its end are the SAME position, so the two
  questions coincide by accident and the leg proves nothing. The fix's own first
  cut asserted it on the reported (empty) shape and failed for that reason.
- **The gate's array slot is not load-bearing, and that is a proof rather than a
  hope.** When it ALLOWS, the caret is by construction inside the item's FIRST
  child, which the content model pins to `paragraph | graphicsBlock` — so it can
  never be inside an `exampleItem`, a `latexComment` or a `codeBlock`, the only
  other blocks in this stack that own Backspace. It sits after
  `DocStructureObserver` + `BlockUuidBackfill` so the observer-first
  keystroke-sanctity invariant (`EXPECTED_MAIN_ORDER` index 1) is untouched.
- **Both surfaces carry it.** `listKeymap: false` is set at the ONE shared
  StarterKit configure site, so a card-body float would otherwise lose list
  Backspace handling entirely.

**Two of the filed diagnosis's predictions are REFUTED by measurement and
recorded rather than assumed** — the fix is the same either way, but a stated
mechanism that is false is how the next reader mis-scopes the next fix:

- the reported case takes the **lift** branch, not `joinItemBackward`. The branch
  selector `hasListItemBefore` probes `$anchor.pos - 2` — the same
  textblock-scoped mistake one helper over — and from a later paragraph that
  lands inside the PREVIOUS PARAGRAPH of the same item, whose `nodeBefore` is
  never a `listItem`. (At a genuine item start it lands on the item boundary and
  answers correctly, which is why gating the START question is sufficient and
  `hasListItemBefore` needs no second fix.)
- **an empty paragraph directly after a list is already deleted correctly** on
  this schema, and a non-empty one still merges into the last item. Both are
  pinned as CONTROLS rather than "fixed".

A third claim, checked and found to be a DESIGN decision rather than a loss: the
empty second paragraph's own `%!v:` anchor does not survive the round trip
(`%!v:bbbb` → the `%!v:blank` sentinel), because `listItem` is a
`DEFERRING_PARENT` — an inner paragraph yields identity to the item
(`assignUuids`). So the only identity at stake in the report was the ITEM's, which
is exactly what the keymap was destroying.

CI: [list-item-boundary-backspace.test.ts](../../../src/lib/tiptap/__tests__/list-item-boundary-backspace.test.ts)
drives the REAL `buildEditorExtensions("main")` stack and dispatches real
`handleKeyDown` at eleven positions plus four Delete positions — a direct `tr`
dispatch cannot see this at all, since the defect lives entirely in which command
the keymap chooses. **No pre-418 suite could see it**: `listKeymap`,
`joinItemBackward` and `liftListItem` appear in no file under `src/`, there is no
list Backspace/Delete suite anywhere, and every list fixture in the repo has
SINGLE-block items, where the textblock-scoped and the item-scoped questions
coincide by construction. The leg with teeth is the CENSUS — the gate was never
the part that could misbehave, a StarterKit config edit that drops
`listKeymap: false` is, and that would silently restore the destruction. Measured
by neutering each half in turn: the pre-418 textblock-scoped gate takes 6 legs,
restoring upstream's `ListKeymap` beside the replacement 6 (five behavioural, one
census). Every control and every Delete leg passes either way, and says so.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live keymap gesture
plus a `.tex` round trip — no disk), so the check is cheap and real: make a bullet
list, produce a second paragraph inside an item, put the caret on the empty line
and press Backspace.

**Residual, stated.** This closes the list keymap's BOUNDARY question. What Enter
at the end of a list item should produce — one candidate producer of the husk —
is untouched, and whether an empty trailing paragraph inside an item should be
normalized away at all is a product call (it is also a legitimate mid-typing
state), deliberately left alone: this task fixes DELETION and leaves the model
alone.
