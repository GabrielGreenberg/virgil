<!-- last-verified: 3a8f4892 2026-09-15 -->
<!-- derives-from: AGENTS.md#laws -->

# Addressing the live document across an async gap

> **A surface that renders from a SNAPSHOT and writes on a later gesture names its target by durable IDENTITY, never by position.** The vocabulary is [src/lib/tiptap/block-address.ts](../../../src/lib/tiptap/block-address.ts) — `BlockAddress` (`uuid` + a pre-hydration `index` fallback), `BlockSpanAddress` (+ `section`), resolved against the LIVE doc at apply time by `resolveBlockIndex` / `resolveBlockSpan`.

This is the "the drop rearranged a different section" class (task 285, the T3 residual). The Outline renders from a debounced `content` snapshot and calls back a frame or more later; between the render that produced the row and the gesture that consumed it, a concurrent writer — Gabriel typing a block insert, an AI `apply_response`, a second window — can add or remove a top-level block ABOVE the target. Every index below the edit shifts, so the reorder moves the wrong section and the click scrolls to the wrong heading. Nothing throws, the document stays well-formed, `doc.check()` is clean; only the content is wrong. T3/W3a fixed exactly this for rename / parTitle / label (`editStructuredNodeByUuid`); reorder, scroll and the three focus-band writes never made the migration, so the panel spoke two addressing models at once.

Four rules it earned:

- **A HYDRATED address resolves by uuid and ONLY by uuid.** A uuid no longer in the document means the block was deleted under the gesture, and the resolve REFUSES (`null`) rather than degrading to the index it travelled with — falling back turns "the thing you clicked is gone" into "so here is a different one," which is the mis-address the module exists to prevent.
- **An UNHYDRATED address degrades for a READ and is REFUSED for a WRITE**, and the asymmetry is the point: the navigation door and the destructive door want opposite fail-safes, so one shared "degrade gracefully" would be a decision nobody made. `resolveBlockSpan` is the strict door — a span is only ever produced by an outline pod, and a pod with no uuid is exactly the case `handleRename` already refuses. This half was WRONG in the fix's first cut, which let the splice degrade positionally on the strength of a stated precedent that does not exist ("the same graceful degradation the rename path chose" — rename refuses). Stating a precedent that isn't there is how the next producer decides an un-hydrated address is safe. The reachable uuid-less producer, since "rare" deserves a name: the legacy `\partitle{X}` parser branch emits an EMPTY top-level paragraph, which `assignUuids` skips and which reaches TipTap through the `content` constructor option, firing no `appendTransaction` for `BlockUuidBackfill` to run in — and that pod is draggable.
- **An EXTENT is re-derived live, never carried.** A heading pod owns its whole section, and the snapshot's `blockCount` is stale in the same way its `blockIndex` is — worse, it is stale under an edit INSIDE the section, which no amount of correct index addressing would catch. So `BlockSpanAddress` carries `section: boolean` and no count at all, and the landing index is computed from the TARGET's live extent too (the pre-285 `landingBlockIndex` folded the target's stale count into the integer it handed over, so a write inside the target section mis-landed the drop even when the source addressed correctly).
- **The affordance may ask the snapshot; the WRITE asks the live doc — and the write refuses one case MORE.** The indicator and its own-range rejection run on the snapshot pods (they must: they paint against what the user sees); the handler re-checks against the resolved spans, off the same shared predicates (`isInsideOwnRange` / `isNoOpLanding`, [outline-drop.ts](../../../src/panels/Outline/outline-drop.ts)) so neither side hand-writes the rule. The extra case is a landing on either BOUNDARY of the dragged run: the write refuses it, because dispatching a delete-and-reinsert that changes nothing costs a history entry and an autosave for a gesture with no effect, while the indicator deliberately still lights it — a section dropped back where it already is leaves the document exactly as the user intended, so the lit line is honest, and going dark there would paint a forbidden-looking band around the dragged section's own position. That is NOT the 083 false-affordance class, which is a line promising a change and delivering none; the adversarial pass on this fix proposed folding the two predicates into one, and the pre-existing suite had already pinned the answer.
- **The section rule is spelled once.** "A heading owns itself up to the next heading of the same or a higher level" had FOUR copies — the pods' `blockCount`, `sectionRange`'s heading branch, the outline's per-section word count, and the live walk the reorder needed. (Three, until the adversarial pass found the fourth still hand-written 700 lines below one of the converted ones, in the same file, while this section claimed "spelled once". A count is a claim like any other.) It is now `sectionExtentFromHeadings` with two adapters — a `(index, level)` list and a doc (`sectionExtentAt`) — because the indicator paints from the snapshot copy while the drop lands by the live one, so a disagreement between them is a line that lies about where the blocks go.

**What crosses the boundary, and what deliberately doesn't.** All five Outline write/navigate callbacks now take addresses: `onScrollTo` (`null` = the Document-start row), `onReorderBlocks(source, target, side)`, and the focus band's `onFocusMoveTo` / `onFocusExpandTo` / `onFocusSnapBoundary`. The focus engine was the subtle one, and its conversion took two passes. It STORES uuids (`FocusBand`), so the row index the outline handed it looked like the single stale input — but resolving that index live while still interpreting it against a heading list threaded in from a render-time `useMemo` leaves two clocks, which is a milder form of the same drift. So the three write actions take an address and NOTHING else: [`regionForAddress`](../../../src/hooks/useFocusMode.ts) derives the heading list from the same live doc it resolves the address against, and `useFocusActions` no longer threads a list into them at all. `FocusBandRow` is itself a `BlockAddress` plus its three offsets, so the row the edge snaps to IS the thing the commit hands over. Two addresses stay deliberately positional and say so at the site: the **Document-start** row (`{ uuid: null, index: 0 }` — "whatever block is first" is a positional fact that survives an insert above by definition) and `resolveDragCommit`'s moved-test (both sides come from the outline's own snapshot, so they describe one revision; what crosses the gap is the commit, and that carries the address).

**Residuals, stated.** `focusMode.activate`'s `currentSeedBlockIndex` is still an index. It is not a captured row — it comes from the section-path recompute, which re-runs on scroll and (unless `disableTier1B` is set) on update — but the gap is narrower, not absent: the value a click reads is whatever the last RAF wrote. `SectionPathEntry` carries no uuid today, which is what closing it would take. The same field's OTHER consumer, the position chevron's match against the outline snapshot's heading indices, is display-only and predates this task.

CI: [block-address.test.ts](../../../src/lib/tiptap/__tests__/block-address.test.ts) pins the resolver rules (including the read-degrades / write-refuses split at the two doors) against a doc that has MOVED since the address was captured — a test against an unchanged document proves nothing here, since the two addressing models agree there by construction. [outline-mutators-address-live-doc.test.tsx](../../../src/components/editor-layout/card-actions/__tests__/outline-mutators-address-live-doc.test.tsx) is the defect leg: the REAL `useEditorOps` handlers against a REAL ProseMirror doc, with the concurrent write applied BETWEEN the capture and the gesture. Measured rather than assumed: neutering rule 1 (resolve by the carried index) fails ten of the two suites' legs, including every reorder and scroll leg whose document moved — the three that survive are the ones testing rule 3 or the own-range guard, which that neuter leaves intact. [focus-region-address.test.ts](../../../src/hooks/__tests__/focus-region-address.test.ts) does the same for the focus band's one entry point — the member with no defect leg at all in the first cut, since `useFocusMode.test.ts` re-implements the action bodies as local helpers and both focus-band-drag suites are snapshot-internal by design. And [outline-address-census.test.ts](../../../src/panels/Outline/__tests__/outline-address-census.test.ts) is the leg with teeth: the resolver was never the part that can misbehave — a PRODUCER that stops carrying the uuid is, and `{ uuid: null, index }` typechecks perfectly while being exactly the pre-285 integer wearing the new type. So `uuid: null` inside the Outline's producers is allowlisted per LINE (not per file — a file-scoped exemption would excuse the next producer added beside it), with a synthetic canary rather than one standing on the lines the allowlist drains.

### The projection half: a filtered view of a list is not an index space into it

Same law, and the case where the gap is not TIME but FILTERING (task 440). Task
285's Outline renders from a snapshot that can go STALE; the panel strip renders
from a projection that is never complete. `visiblePanels` is
`filterPanelKinds(chrome, …)` — narrowed by `chrome.visiblePanelKinds` — so an
integer counted off the rendered icons is not an integer into
`prefs.placements`, which is what `movePanel` spliced into.

`READER_CHROME.visiblePanelKinds` is the six reading panels and the shipped LEFT
placement order opens with `search`, which is not one of them. So the Library
Reader renders **5 icons over a 6-entry list** and every DOM index k addressed
model index k+1: drag `outline` into the gap between `citations` and
`bibliography` and it lands **before** `citations`, one slot early — every drop
below the first gap wrong by exactly the number of hidden panels above it.
Nothing throws and the placements list stays well-formed.

**The main app was correct by COINCIDENCE, and the coincidence is the finding.**
`FULL_CHROME` sets no whitelist, and the one registry kind with no strip (`omni`,
`defaultStripSide: null`) is dropped from `placements` at load — so the two spaces
happen to agree, and that agreement was the entire defence. It is one whitelist,
one per-doc hide or one search filter away from being false anywhere.

> **A gesture over a filtered view commits the IDENTITY of what it landed
> beside, never a count.** `movePanel(id, side, before?: PanelId | null)` —
> `before` is the panel the icon lands in front of, `null`/omitted appends — and
> the splice resolves it against the LIVE `placements` at apply time.

Four rules it earned:

- **Unrepresentable beats reconciled.** The surgical fix — translate the DOM
  index into a model index at the call site — is correct for today's one
  whitelist and leaves the integer contract standing for the next filter to
  rediscover. Taking an id removes the second index space instead of mapping
  onto it, and it survives ANY future narrowing of the strip with no further
  thought: the gesture then computes only *which rendered button the cursor is
  above*, which is the one thing it can actually observe.
- **This member ships with no grep, and the reason is stated rather than
  assumed.** Every other door law in this file carries a census because a call
  site that never asks it type-checks perfectly. Here it does not: `PanelId` is a
  string union, so an integer at the call site is a COMPILE ERROR, and `movePanel`
  is the only place a GESTURE writes placement order in either silo — checked,
  not assumed; the only other order-writer is the load-time merge that appends
  newly-shipped panels. The compiler is the census.
- **Resolve-or-append, and it is the right ANSWER as well as the safe rung.** An
  id no longer on that side — raced out by a peer window, or a visible-but-unplaced
  tail kind that has no placement row at all — degrades to append, exactly
  `resolveBlockIndex`'s read-degrades posture. It is also *correct*: the unplaced
  tail renders after every placed kind, so appending lands the icon precisely
  where dropping in front of that tail means.
- **The "which buttons count" rule stays spelled ONCE.** Task 439 moved it into
  the gesture's one geometry snapshot; the index survives only as indicator
  geometry and never leaves the module, while `beforeId` is what crosses the
  boundary. Hover and release read the same slot, so the line the user sees and
  the slot the drop takes cannot disagree (tasks 258/321/332).

CI: [strip-drop-identity.test.tsx](../../../src/hooks/__tests__/strip-drop-identity.test.tsx)
drives the REAL `useViewPrefs` engine (ephemeral — the same engine the Reader
mounts) over the REAL shipped defaults and the REAL Reader whitelist, and SWEEPS
every gap on both sides rather than pinning one. **No pre-440 fixture could see
this**: every one drives the FULL placement list, where the projection and the
model are the same list by construction. Each case ASSERTS its own divergence
(the strip is shorter, and its first icon is not the model's first entry) so no
leg can pass by the two lists being trivially equal, and the defect leg
reimplements the RETIRED integer rule locally — measured, it is wrong at every
gap below the first, for every icon. The gesture half is in
[strip-button-drag-teardown.test.tsx](../../../src/components/editor-layout/__tests__/strip-button-drag-teardown.test.tsx),
where the hover≡release leg derives the offered id from the PAINTED bar rather
than hard-coding it on both sides. Measured by neutering each half in turn: the
pre-440 integer commit takes 3 gesture legs, an always-append resolution 5 model
legs, and the non-regression sweep (no whitelist, both sides, every gap) is
byte-identical to the retired path either way — which is the point.

**Owed, not claimed:** the preview eyeball, which needs a real Library paper
open — in the Reader, drag `outline` between `citations` and `bibliography` and
confirm it lands there.

### The ref half: a NON-unique key is not an address, and three tables were one

Same law, the inline atom (task 550) — and the case where the sibling atoms
already carried identity for exactly this reason and the `\ref` chip never
did. A paper cites the same section several times, and every step of the
`\ref` popover's edit path resolved the chip by its LABEL STRING: the
NodeView's click carried `{ label, refCommand }` and nothing else (where
`virgil-math-click` carries `{ pos, editor }` and `virgil-citation-click` its
`clickedPos`); the bridge re-found the chip with a document-wide
`querySelector('[data-label=…]')` — the FIRST in DOM order, off-screen for a
later duplicate, and under multi-doc keep-alive possibly a HIDDEN pane's chip
(task 438's class); and the change handlers walked the doc and rewrote the
FIRST `labelRef` naming the old key. So re-pointing the second
`\ref{sec:intro}` opened the popover beside the first and silently changed
the first. Nothing threw; the `.tex` was well-formed.

**The second half was a twin resolver, and there were THREE of it.** The task
named two — the numberer's `resolveRef` and the popover's
`resolveLabelDisplay` — and the parser held a third (`numberHeadings` +
`numberFigures` + `resolveRefs`, over JSON). They had drifted in BOTH
directions: the popover copy had no figure branch, so a re-point at `fig:x`
wrote `??` into the atom — and the numberer's structural gate cannot see an
atom-attr write, so it stood until an unrelated edit; and the numberer copy
never registered a flat sub-item label (`\a \label{foo}` → "3a"), so a ref
the parser had resolved correctly at load flipped to `??` on the first
structural edit. Task 341's twin rule, with a third member.

> **A `\ref` chip is addressed by IDENTITY — the editor that owns it and its
> position there — re-checked at commit and REFUSED on mismatch, never
> re-found by a label the paper repeats. And "what does `\ref{label}` show?"
> has ONE table: [`ref-display.ts`](../../../src/lib/ref-display.ts) builds the
> ref-target index (heading section numbers, figure numbers, the example key
> table, every `labelRef`) off one walk, generic over the node representation,
> and the parser (JSON), the numberer (PM) and the popover (PM) all read it.**

Six rules it earned:

- **The click carries the pos-space it was minted in.** `RefClickDetail` is
  `{ label, refCommand, targetKind, pos, editor, rect }` — the
  `AtomCreateRequest` / `virgil-math-click` shape the bridge already validates
  (a detail without a numeric `pos`, an owning editor or a `DOMRect` is
  DROPPED, never resolved against MAIN). The rect is THIS chip's own, so the
  popover anchors where the user clicked; and it is re-minted as a `DOMRect`
  at the dispatcher, because a headless DOM's `getBoundingClientRect` answers
  a plain object that the bridge's validation would otherwise drop.
- **The write re-checks the identity and REFUSES.** `locateRef` requires
  `editor.state.doc.nodeAt(pos)` to still be a `labelRef` naming the clicked
  label; the doc may have moved under the popover, and the fallback the old
  handlers took — "the first chip with that label" — is the mis-address this
  identity exists to prevent (task 285's rule, one atom in). A refusal returns
  `false` over an untouched document.
- **The NUMBER is read from MAIN; the WRITE goes to the owner.** The chip may
  sit in a footnote or note body (its own editor, its own pos-space); a card
  body owns no declarations, so the display resolves against the main doc
  (the rule `handleInsertRef` already held) while the `setNodeMarkup` lands in
  the editor the identity names.
- **The index carries the NUMBERING rows too, not just the lookup.** The
  parser and the numberer each used to compute section numbers and figure
  numbers privately and then build a lookup from them; now both write
  `sectionNumber` / `figureNumber` FROM the index's rows and resolve every
  chip FROM the same index. So "what number does this heading have" and
  "what does a ref to it show" cannot disagree — they are one table, built
  once per load / per structural change. The live door
  (`resolveLabelDisplay`) DERIVES the number rather than reading a heading's
  attr, which also makes it independent of whether the numberer has run yet.
- **Precedence is stated once and it is the numberer's**: heading > example >
  figure for a key two kinds declare; within a kind the first declaration in
  document order; the dotted `parent.sub` form only after every exact key has
  missed. The JSON accessors' caption predicate is `hasCaption` alone, for the
  reason the parser already stated at its site.
- **The exemption in 534's ref-walk census is RETIRED, not kept.** That leg
  excused `handleRefChangeLabel`'s label walk as "a different gesture that
  stops after the first hit" — which was the defect, pinned as the contract.
  The re-point walks nothing now, so the rename door is the only ref walker
  left; and the task-433 plugin census reads the numberer as `clean` rather
  than `tagged`, because its one walk moved behind an IMPORTED helper the
  census states it cannot follow — the `[cost: …]` tag stays as the site's
  justification, and the per-keystroke gate is unchanged.

Two more readers came right for free: `gatherLabels` lists a modelled
`figureBlock`'s label with its number (it listed only raw-text figure labels
before), and `handleRefJump` reaches a figure through the index's positions.

CI: [ref-display.test.ts](../../../src/lib/__tests__/ref-display.test.ts) drives the
leaf over every target kind, pins JSON/PM PARITY over ONE parsed document (the
parser's index and the mounted doc's index are the same targets map, and what
the parser wrote at load is what the live door answers for every chip), and
carries the numberer-drift DEFECT leg — a structural edit after load leaves a
flat sub-item ref at "1a". Its CENSUS pins exactly one index builder, no
`headingMap` / `exampleMap` / `figureMap` anywhere in production, every
reader importing the leaf, and the numberer's stale prose ("displayText may
stay stale") renegotiated. [ref-repoint-identity.test.tsx](../../../src/components/editor-layout/card-actions/__tests__/ref-repoint-identity.test.tsx)
drives the REAL `useRefActions` over a doc with TWO chips to one label, and
the REAL NodeView's DOM click through the REAL bridge — **no pre-550 suite
drove a document with two refs to one label, so "the wrong chip changed" was
unrepresentable in all of them.** Measured by neutering each half in turn: a
label-first-match re-point takes 5 legs, the missing figure branch 6, the
missing flat sub-item claim 6.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture, no disk): two refs to one section, click the SECOND, change its
target — only it changes, and the popover sat beside it.
