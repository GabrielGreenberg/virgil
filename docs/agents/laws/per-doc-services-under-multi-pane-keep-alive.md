<!-- last-verified: 3a8f4892 2026-09-15 -->
<!-- derives-from: AGENTS.md#laws -->

# Per-doc services under multi-pane keep-alive

> **A module-level value that is per-DOCUMENT is a REGISTRY keyed by its owner, never a single slot — and a departing owner removes only its OWN entry.** N `EditorPane`s are mounted at once (multi-doc keep-alive, default ON at capacity 3; the Library Reader mounts the same component again, up to 4), one visible and the rest `display:none`. "The current doc" is therefore not a module-level fact. Where a caller has no owner in hand, resolve through the ONE ladder — `pickActiveByEditor` / `pickProbeEditor` ([src/lib/active-editor-probe.ts](../../../src/lib/active-editor-probe.ts)): focused → visible (`offsetHeight > 0`, which is exactly what `display:none` falsifies) → sole → null. Never "whichever was written last".

This is the "drag-and-drop goes dead after switching back to a paper I already had open" class (task 329), and its two failure modes are the pair `editor-actions-bridge.ts` had already named and closed for typed actions:

- **MIS-ROUTE.** A warm switch is a visibility flip, not a remount, so with last-writer-wins the pane that mounted LAST kept the slot forever. Every doc-scoped read then addressed the wrong document — and each consumer failed differently, which is why the symptom looked like nothing at all: `hitTest` rejected every `targetScope: "main-only"` spec, `text-range-move` resolved no source range, and `inlineAtomMoveSpec` fell through to its CREATE branch, where `atomAttrsFor` read the *other* doc's footnote hook, degraded to `emptyRichContent()` and landed an **empty `\footnote{}`** carrying the card's real id — the task-233 shape, re-entered from the side.
- **CLOBBER.** The unmount cleanup wrote `null` unconditionally, so evicting an LRU tail, closing a background tab, or a Library-reader round trip disarmed drag-and-drop **app-wide** until some pane mounted fresh.

Four rules it earned:

- **Key by the OWNER, not by the doc.** The drop registry keys on a token the provider mints once, because a provider registers while its `mainEditor` may still be null — the ctx's own getters resolve it later. `target-registry.ts` keys by DOM node and the actions bridge by `editor.view`; all three dispose identity-guarded (`if the entry is still mine`), which is what makes "an evicted pane can never null out a live one" structural rather than careful.
- **Bind the value to the GESTURE, not to a global "current".** `DropSession` carries the `DropCtx` it started in, resolved once at `beginDropSession`, and the hit-test and the commit both read `session.ctx`. This is strictly stronger than "whichever pane is visible": it is correct with two visible panes (a future split view, Reader-beside-doc), it survives a pane mounting or gaining focus mid-drag, and it makes `ctx.mainEditor` mean *the document this gesture began in* BY CONSTRUCTION — the invariant every consumer already assumed. A producer that knows its editor (the in-text atom grab, the lifted-overlay grab) passes it as an exact hint; the rest take the ladder.
- **The ladder is the three rungs it names, and NOTHING else — a caller's own short-circuits stay at the CALL SITE.** Each registry brackets `pickActiveByEditor` with two decisions that are its own: a *sole-entry* short-circuit ABOVE it (return the one entry whatever its editor looks like — this is what keeps a `mainEditor: null` pane, Reader mode, and every hand-built test fixture resolving), and a *last-resort* tail BELOW it (the drop registry's legacy default slot; the bridge's `DEFAULT_KEY`). Folding either into the shared function looks like tidying and is a wide silent regression — it would null out the view-less publish path the cross-surface action suites all run through. `findRowScroll` ([layout-scroll.ts](../../../src/components/editor-layout/layout-scroll.ts)) is the same shape in the DOM: a `≤1 match` short-circuit around the same visible-wins rule. The ladder's contract is stated where it lives: an entry whose accessor answers `null` does not participate, and **the caller decides what to do when nothing wins** — so it takes no `fallback` parameter (a defaulted argument is a decision nobody made).
- **Deep ≠ broadest blast radius.** The other module singletons in this neighbourhood — `card-lift`, `dock-drag`, `stack-drop-target`, `inline-atom-source`, `drag-ghost` — are **gesture**-scoped, and one gesture at a time app-wide is *correct* for them. Do not convert them; keying a genuinely app-global value by pane is the same error mirrored.
- **A window listener registered per pane is this bug with no ctx in it.** `EditorPane`'s `virgil-stack-drop` handler is one: the event is dispatched on `window`, so every warm pane answered it, each snapshotting against its own doc and calling its own `closeCardPopout`. It gates on `isVisibleRef.current` — the ref, never the render value, because a warm pane is not remounted on a switch and a captured value would freeze at its mount-time answer. A pane outside any keep-alive provider (the Reader) reads `true` and behaves as before.

CI: [dropctx-multipane-registry.test.tsx](../../../src/components/drop-mode/__tests__/dropctx-multipane-registry.test.tsx) mounts TWO real providers with settable DOM visibility (jsdom reports `offsetHeight === 0` for everything, so each fake editor defines its own) and pins the ladder, the scoped dispose, the session binding and the exact hint; five of its legs fail on the pre-fix semantics, and two are explicit non-regression pins — a warm switch still moves ownership, and unmounting the pane that OWNS a live session still cancels it (the atoms-draggable protection: an `externalCommit` gesture has no controller mouseup of its own, so the crosshair cursor and the global `user-select:none` would stick with nothing left to clear them). The leg with teeth is the **census** — the registry was never the part that could misbehave, a second publisher going through the legacy single slot is, and that would reinstate the clobber with every behavioural leg green. No production file in either silo may call `setDropCtx`; a hit is MIGRATE-it, never an allowlist entry.

**Verification, honestly:** this class masks in the dev preview (multi-pane + FSA), so the durable proof is the unit contract above and a real-app eyeball is *owed*, not claimed.

### The LISTENER half: every per-pane listener declares its scope (task 598)

The rule above was written for ONE handler, and one handler obeyed it. A sweep of the pane's subtree found the rest of the family:

- **The pristine-card discard.** `usePristineCardManager` put a capture-phase `pointerdown` on `document`, once per pane. A hidden pane's blank card is still in the DOM under `display:none`, so a click in the visible paper was "outside" it — switch papers with the keyboard, click once, and the other paper's blank note was gone.
- **The orphan events.** `virgil-anchor-orphaned` / `virgil-textobject-orphaned` carried no `docId`. The anchorId or uuid tells one document's cards apart, but it cannot tell two documents apart: open the same paper as a document and in the Reader (or open a duplicated folder) and every pane cleared its own card and wrote its own sidecar for a deletion that happened in one of them.
- **The hover bridge, the resize followers (scrollbar, pending-change pill, selection bolt, grab handle), and margin-edit's Escape**: work (or a cancel) in panes nobody can see.

The fix is two doors and a census:

1. **`usePaneScopedListener(target, type, handler, { capture, passive, enabled })`** in [visibility-context.tsx](../../../src/lib/keep-alive/visibility-context.tsx) (with `useIsVisibleRef()` for handlers inside a larger effect). It reads visibility through a REF at event time, and gets the latest handler through a ref too, so an inline closure never re-registers. A follower that skips its work while hidden must also catch up when the pane is shown again. The pill and the selection bolt re-run their placement when `isVisible` turns true. The scrollbar needs nothing extra: its ResizeObserver fires when the row gets its size back.
2. **[orphan-events.ts](../../../src/lib/tiptap/orphan-events.ts)** owns both orphan events. `dispatch*` stamps the `docId` of the editor whose transaction removed the anchor (from the `docIdRef` in the extension ctx, the same way `Footnote` gets it), and `useAnchorOrphaned` / `useTextObjectOrphaned` answer only their own doc. The rule is STRICT on `docId: null`: a surface that knows no document is nobody's orphan. Floats pass the host doc's `docIdRef`, so they are heard as the main editor.
3. **The census**, [pane-scoped-listener-census.test.ts](../../../src/lib/keep-alive/__tests__/pane-scoped-listener-census.test.ts). It follows the import closure of `EditorPane.tsx`. Every `window`/`document` `addEventListener` in that closure with a literal or CONSTANT event name needs a LEDGER row naming its scope: `visible`, `doc`, `target`, `gesture`, `open-state`, `by-design`, `shared-state` or `singleton`. Each scope comes with a source check the file must pass, and the event lists must match exactly in both directions. A registration whose event name is a lower-case variable is allowed only inside the two doors. A separate leg rejects any raw orphan-event literal outside `orphan-events.ts`. Neutering it against the pre-598 sources fails 3 of its 9 legs.

Residual, stated: the Reader's pane sits outside any keep-alive provider and reads `visible = true` always, so a Reader pane and a shown document pane both answer a pane-scoped listener. That was the behaviour before this change as well. A two-paper real-FSA eyeball of the pristine and orphan legs is owed.

### The DOM half: a per-PANE MARKER is resolved the same way

Same law, other medium (task 438) — and the case where the ladder existed, was
correct, was cited BY NAME in the comment above the very gate that half-closed
this, and reached none of the four sites that resolve a per-pane marker in the
DOM.

A mounted pane stamps five per-PANE markers — `[data-strip-side]` on the tool
strip, and `[data-panel-column-side]` + `[data-flex-col]` (the same element),
`[data-stack-frame]` and one `[data-dock-slot="<side>-<index>"]` band anchor per
docked band from `PanelColumn`. None of those selectors carries a pane
discriminator: `left-0` exists once per mounted pane with a left band. Seven
call sites resolved them with a **document-global**
`querySelector`/`querySelectorAll` and took the FIRST match. `PanelColumn` is
not gated on `useIsVisible()`, so a hidden pane renders its column, its frame
and its anchors with every rect zero.

**Why "first in DOM order" looked safe, and where it stopped being safe.**
`useKeepAliveLRU` promotes the ACTIVE doc to the FRONT of the keep-alive order,
so among the three authored panes the first match really was the pane the user
was looking at — which is exactly why this survived. The Library Reader's pane
is not in that list: `EditorLayout` renders the doc keep-alive block BEFORE the
paper/library block, so **whenever the user is on the Library pane every doc
pane is hidden, still mounted, and still first**. The hazard is therefore
Reader-shaped today and general tomorrow, and the fix is a behaviour TRADE
rather than a strict improvement — see the visible-edge rule below.

> **A per-PANE DOM marker is resolved through ONE door
> ([pane-dom.ts](../../../src/components/editor-layout/pane-dom.ts)) reading the rung the
> editor ladder already names — a hidden pane is exactly what
> `offsetParent === null` / `offsetHeight === 0` reports, and nothing else in a
> mounted tree does.**

Four members, and the first two are the ones the user meets:

- **M1 — the Reader's docked panel renders into a HIDDEN subtree.**
  `FloatingPanel` resolved `left-0` to the hidden doc pane's anchor and portaled
  its whole pod into a `display:none` subtree. The panel is "open" in prefs, the
  strip icon lights `aria-pressed`, and nothing appears anywhere. The hidden
  pane's own `FloatingPanel` had already returned null under the `isVisible`
  gate — which is *why* the anchor was present and free, and why that gate does
  not save it: it closes the half where a hidden pane is the PRODUCER, and this
  is the half where it is the first consumable ANCHOR.
- **M2 — the Reader can never stack two docked bands.** `measureOmniGap(side)`
  read a zero-rect hidden column, so BOTH its branches returned 0;
  `placeInStack`'s `fits = freeSpacePx >= MIN_BAND_PX` was then false for every
  Reader strip-open and the second panel opened evicted the first, forever, with
  no room problem at all.
- **M3 — the dock hit-test snaps to a zero-rect hidden column.** A hidden column
  reports `left = right = 0`, so its snap corner `(0, TOP_BAR + podGap)` sits
  nearer the viewport's top-left than any real column's and wins
  `resolveDockTargetByPanelProximity` outright; `resolveBandTargetIn` then reads
  its all-zero band rects and answers `index = bands.length` with a zero-size
  outline. Same shape task 272 recorded for the 0px COLLAPSED column, one cause
  over — that one was fixed by clearing the collapse sentinel, which does
  nothing for a hidden pane.
- **M4 (mild, fails open) — `computeColumnSpawnRect` drops to its hard-coded
  fallback** because a zero rect misses its `width > 0 && height > 0` guard.
  Listed because it is the same sweep and it moves with the others, or it
  becomes the next reader's "the pattern is fine here".
- **M5 — a divider drag PERSISTS a hidden pane's zero width into the user's
  prefs.** `syncPanelPrefsToRendered` sweeps `[data-flex-col]` (the SAME element
  as M2/M3/M4's, under a different attribute name) on every panel/margin
  drag-start and writes each column's rendered width to `panelWidths[side]` /
  the zen margins. It iterates in keep-alive LRU order and the LAST write per
  side wins, so a warm hidden pane could write `0`. Found by the adversarial
  pass on the fix — and it is the strongest argument that a census keyed on
  attribute NAMES has to enumerate every name a pane stamps, because this call
  sat thirty lines from converted code, on the same DOM node, under a comment
  asserting the exact premise the task retires (*"`[data-flex-col]` is a unique
  attribute on the active EditorPane's panel columns"*).
- **M6 — the strip-icon drag hit-tests a hidden pane's strip.**
  `[data-strip-side]` is stamped once per `EditorPane` and read find-first
  twice: to POSITION the drop indicator, and to compute the drop INDEX from
  that strip's own `[data-panel-id]` buttons. A hidden strip gives an indicator
  at the viewport origin and an index counted off the wrong pane's icons — the
  hover and the commit answering from different tables, which is the law
  "Pane-drag stability" already states one subsystem over.

Five rules it earned:

- **The two miss policies are DIFFERENT CLAIMS, so the argument is REQUIRED.** A
  MEASUREMENT reader (`measureOmniGap`, `computeColumnSpawnRect`,
  `findRowScroll`) fails OPEN — measuring the wrong column is the pre-438 status
  quo, while `null` turns a working feature off. A PORTAL TARGET
  (`FloatingPanel`'s anchor) fails CLOSED — an invisible anchor is strictly
  worse than the body fallback the caller already has. A defaulted policy would
  be a decision nobody made.
- **The set form fails open as a SET.** `paneColumns()` filters to visible and,
  if that leaves nothing, hands back everything — so a sweep can never turn a
  gesture off.
- **The second spelling was retired with it.** `findRowScroll` had implemented
  this exact rule privately for a FOURTH per-pane marker
  (`[data-virgil-row-scroll]`), citing `active-editor-probe` in its own
  docstring. It reads the shared resolver now, keeping its name for its ~dozen
  callers; its pre-existing `≤1` short-circuit is exactly what fail-open
  generalizes to N.
- **A fail-CLOSED resolution must run at a moment when the answer EXISTS, so it
  is re-taken on the VISIBLE EDGE.** `FloatingPanel`'s effect had deps of
  `[mode, slotKey]` and its `!isVisible` bail sits AFTER the hooks, so a pane
  that MOUNTS while hidden — clicking a tab while the PDF viewer is up mounts
  the new doc pane one commit before `pdfView` flips off — resolved once,
  found nothing visible, body-portaled, and never ran again. Fail-open hid that
  (it answered with the LRU-front pane, which was about to become visible);
  fail-closed exposes it, which is why the two shipped together. The same dep
  closes a hazard that predates both: a `dockStack` change made in pane A
  re-keys pane B's slot WHILE B IS HIDDEN, so B resolved A's anchor and kept it
  across the switch. Skipping while hidden costs nothing — the component
  returns null there, so there is no portal to keep pointed at anything.
- **A `?? document` fallback is a document-global resolution wearing the
  relative form's clothes.** `BandDivider.getValue` had one; with no frame in
  hand it would answer with whichever pane came first, hidden ones included. A
  divider with no frame has nothing to trade, so the honest answer is no
  elements — and the census's EMPTY allowlist is only true because that
  fallback was retired rather than exempted.
- **`offsetHeight > 0` is a BACKSTOP, not the primary signal.** `offsetParent`
  is null for a `position: fixed` element that is perfectly visible, so the rung
  is the disjunction. A `display:none` subtree fails both.
- **Scoped by CSS VISIBILITY, not by REACT TREE — stated at the door.** Exact
  for the shipped topology (at most one visible pane); NOT exact for two
  simultaneously visible panes (a future split view), where both pass the rung
  and the first still wins. The context-scoped fix is wider (`FloatingPanel`
  mounts from several places) and does not help `readDockGeometry`, which is
  called from a gesture with no pane in hand. Take the filter now; the context
  is the follow-on if a split view ships.

CI: [pane-dom-multipane.test.tsx](../../../src/components/editor-layout/__tests__/pane-dom-multipane.test.tsx)
builds TWO panes — the hidden one FIRST, as production renders them — and drives
each door plus the REAL `FloatingPanel` in docked mode. **No pre-438 suite could
see any of this**: every panel-column / dock / spawn fixture in the repo builds
ONE column tree, where "the first match" and "the visible pane's match" are the
same element by construction. The leg with teeth is the CENSUS
([pane-dom-census.test.ts](../../../src/components/editor-layout/__tests__/pane-dom-census.test.ts))
— the door was never the part that could misbehave, a call site that never asks
it is, and `document.querySelector('[data-dock-slot="left-0"]')` type-checks
perfectly. Allowlist EMPTY; a relative `closest(…)` / `root.querySelector(…)`
from an element already inside the pane needs no ladder and stays legal.
Measured by neutering each half in turn: the pre-438 resolution takes 10
behavioural legs plus 3 census legs (which name all four original sites);
reverting the `FloatingPanel` call site alone takes 2; the visible-edge deps 1;
and the two later members (`[data-flex-col]`, `[data-strip-side]`) 2 behavioural
plus 3 census. Two of this suite's own first-draft legs were vacuous and are
recorded rather than quietly fixed: a census that stripped STRING LITERALS
erased the very selector it greps for (so every leg passed on the pre-fix tree —
the canary is what caught it), and a "the miss policy is stated" leg read the
RAW file, where both policy literals appear in the door's own header prose.

**Owed, not claimed:** a real eyeball. The repro needs a granted authored doc
AND a Library paper open at once, which is the FSA/multi-pane-masked class, so
the durable proof here is the unit contract.

#### The CENSUS half: a guard whose COVERAGE is a literal ages out silently

Task 597 is the sixth member, and it is the one the census above could not see.
`[data-editor-page]` — stamped once per `EditorPane` on its `.paper-render`
wrapper — was a per-pane marker from the day it shipped, `print.ts` resolved it
off `document`, and the census passed anyway with its allowlist proudly EMPTY:
`PANE_MARKERS` was a hand-kept list of five NAMES, and nothing forces a newly
stamped attribute onto a literal. **An empty allowlist is a claim about what
was checked, not about what exists.**

The member itself is worse than the five before it, and the difference is what
sets the miss policy. M2–M4 MEASURE the wrong pane; this one ACTS through it.
`applyPrintAttrs` walks up from the page tagging every ancestor
`data-print-ancestor` and every off-chain sibling `data-print-hide`, and both
print rules carry `!important` — with `[data-print-ancestor] { display: block }`
being exactly the declaration `KeepAliveSlot` relies on to hide a warm pane. So
anchoring on the hidden pane does not print the wrong thing by accident: it
UN-HIDES the warm doc and HIDES the paper the user is looking at. That puts it
in `paneDockSlot`'s class, not `paneColumn`'s — **fail-closed**, because a
fail-open answer hands back precisely the element that causes the inversion,
while `null` degrades to "no page isolation", the posture the browser's own
File → Print door already takes.

The fix that stops the NEXT member is the second half: the census's question is
INVERTED. It no longer asks "is one of these N names resolved globally" but
**"is ANY `data-*` attribute resolved off `document` in production"** — and each
answer must sit in an `EXEMPT_GLOBAL_MARKERS` map with a stated reason (the
per-CARD family, which `omni-card-placement.ts` owns; the genuinely
document-level float layer and app-shell `<script>`). Default is FAIL, so a new
per-pane marker read globally fails on its first commit with no list to
remember to grow; a companion leg deletes an exemption whose call site is gone
("a registry earns its name by being read"). Stated limit, the same one the
original needle carries: a selector assembled entirely from interpolated
constants spells no literal `data-` and is invisible — all eleven current hits
spell at least one.

Measured by neutering in 4 cuts: restoring the bare `querySelector` takes 5 legs
(2 behavioural, 3 census); doing that AND removing `data-editor-page` from
`PANE_MARKERS` — i.e. the exact pre-597 state of this file — still takes the
derived leg, which is the whole point; a stale exemption takes 1; flipping the
miss policy to fail-open takes the policy census plus the no-visible-pane leg.

#### The NEEDLE half: the census reads MEANING, not spelling (task 600)

The coverage fix above widened WHICH names the census asks about; the needle
that finds a call was still a regex over source text with a substring test on
the captured argument. So the same violation passed written as
`` document.querySelector(`[${DATA_STACK_FRAME}]`) `` (no literal marker — the
"stated limit" above), `getElementById`, `const d = document; d.querySelector`,
`el.ownerDocument.querySelector`, a `+` concatenation, or any argument with a
nested `)` (`[^)]*` stopped at the inner closer). **A guard's needle is part of
its claim**: an empty allowlist behind a spelling-matcher says less than it reads.

The needle is now a parsed AST
([_document-query-scan.ts](../../../src/components/editor-layout/__tests__/_document-query-scan.ts),
the TypeScript compiler, already a dependency). It RESOLVES the receiver
(`document`, `window`/`globalThis`/`self`.`document`, any `ownerDocument`,
`.body`/`.documentElement` of one, a `const` alias, and a `?? document` /
`|| document` / ternary fallback) and FOLDS the argument (literals, templates,
`+`, and `const` bindings — local or imported by relative/`@/` specifier). An
unfoldable part is a `HOLE` character no marker contains. The resolver-call leg
(`resolvePaneMarker(…)`) uses the same folding. The scanner's header states what
still passes: runtime-computed selectors, scope-blind aliasing, parameters,
namespace imports and re-export chains, non-DOM wrappers.

Widening the needle surfaced three reads the regex never saw — all constant-built
and all outside this door: `drag-ghost.ts`'s `GHOST_ATTR` sweep (body-level) and
the anchor-highlight reconciler's `DATA_CARD_SELECTED`/`DATA_CARD_HOVERED` panel
sweep (per-CARD, the same call already exempt for `data-card-key`). They are
listed with reasons. Measured by neutering the scanner back to regex power:
7 of the 8 new canaries fail plus the stale-exemption leg; the eighth (nested
`)`) cannot fail that way because a parser does not truncate — the old regex's
capture of that fixture was confirmed by hand to stop at `attrOf(x`.

### The GLOBAL-CHROME half: app-global chrome is MOUNTED ONCE, not once per pane

The inverse reading of the same law (task 589). The rules above say what to do
when a module-level value is per-DOCUMENT. The Stack said the opposite and was
broken by the opposite mistake: the value is genuinely APP-GLOBAL — one
localStorage envelope (`useStack`), one cached icon rect
([stack-drop-target.ts](../../../src/lib/stack/stack-drop-target.ts)), one
illuminated-ring signal — while its CHROME was rendered by every `EditorPane`.

**A `createPortal` to `document.body` escapes the keep-alive wrapper.** That is
the fact the per-pane mount got wrong. `KeepAliveSlot`'s `display:none` hides a
subtree, and a portal is not in that subtree: N warm panes (capacity 3, plus the
Library Reader — and `ReaderLRU` keeps several of those) each painted an
identical `position:fixed` button at the same bottom-left spot. So:

- **Capture went dead.** Each mounted `StackIcon` wrote the one module-level
  `iconRect` and each one's cleanup set it to `null`. Evicting an LRU tail
  (opening a 4th paper) or closing a Reader therefore erased it; the survivors'
  publish effect has `[]` deps and never re-published. From then on
  `isOverStackIcon` answered `false`, so `FloatingPanel` neither lit the ring nor
  fired `virgil-stack-drop`, and `LiftHost` never captured a lifted paragraph —
  the user dragged a card onto the Stack and it just dropped as a float. A window
  resize repaired it, which is why it read as flaky rather than as broken. This is
  the CLOBBER failure mode above, in a value that is not per-doc at all.
- **The icon toggled a hidden pane's strip.** `stackOpen` was per-pane `useState`
  while the topmost portal was the LAST-mounted pane's, so a capture opened the
  visible pane's strip and the button could then only toggle some other pane's.

The fix is not to key the chrome by pane — that is precisely the "keying a
genuinely app-global value by pane is the same error mirrored" warning above.
It is to **mount it once**
([StackChromeHost](../../../src/components/stack/StackChromeHost.tsx), rendered a
single time by `EditorLayout`, above the keep-alive slots and beside the Library
surfaces), and to let each pane publish only the per-doc half it actually owns —
a `StackTerminal` (editor, source attribution, bib resolvers, chrome gate) in
[stack-terminal.ts](../../../src/lib/stack/stack-terminal.ts), with the same
owner-token registry + identity-guarded dispose + `pickActiveByEditor` ladder
`drop-mode/controller.ts` uses, for the same reasons.

Three rules it adds:

- **Resolve the owner AT THE GESTURE, not at render.** The icon's HTML5 drop door
  calls `getStackTerminal()` inside `onDrop`. A terminal captured as a prop at
  render would freeze at whichever pane last caused the single host to re-render —
  which for the bib obligation (task 235) means a `\cite` carrying the WRONG
  document's entry. Same reasoning as "bind the value to the GESTURE" above.
- **The chrome GATE is an ANY over the registry, not the resolved terminal's
  answer.** `someTerminalWantsChrome()` preserves exactly the aggregate semantics
  the per-pane mount had (chrome existed if any pane had `viewPrefs && !zenMode`),
  including the surfaces where the ladder is honestly ambiguous — PDF view, where
  every doc slot is `display:none` and no pane wins. It is not a guess: zen is
  uniform across doc panes (one `zenModeOn` feeds every bundle) and always `false`
  in the Reader. Using the resolved terminal there would make the icon vanish in
  PDF view — a decision nobody made.
- **A singular slot still checks its owner.** `setStackIconRect(owner, rect)` now
  clears only if the caller still holds the slot. The value stays app-global — it
  was NOT converted to a per-pane registry — but "my teardown erases the live
  value" is the defect this task retired, and an unchecked `null` is one
  second mount away from reinstating it.

CI:
[stack-chrome-single-host.test.tsx](../../../src/components/stack/__tests__/stack-chrome-single-host.test.tsx)
— a stale owner's `null` is a no-op while the current owner's still clears; a
superseded registration's disposer removes nothing; three registered panes yield
exactly ONE `[data-stack-icon-hit]` and one `[data-stack-strip]`; the strip's open
state is global; the ANY gate. Plus the structural floor as a CENSUS — the
registry was never the part that could misbehave, a second mount site is — so
`EditorPane` may contain no `<StackIcon>`/`<StackStrip>` element and `EditorLayout`
exactly one `<StackChromeHost>`. Neutered in four cuts (the rect owner check, the
registry identity guard, the chrome gate, the per-pane mount), each of which
fails its own legs.

**Owed, not claimed:** a real eyeball — open four papers so the LRU evicts a
pane, then drag a note float onto the Stack icon and confirm the ring lights and
the item lands. Multi-pane + FSA is the masked class; the durable proof is the
unit contract above.

### The WINDOW half: releasing ownership is a WRITE-ORDERED event

> **A window drops a doc's cross-window hold only after that doc's pending
> writes have drained — and `releaseDoc` owns the ordering, no caller
> re-derives it.**

The multi-pane law's sibling across windows. `withDocLock(docId, fn)`
short-circuits (`heldReleasers.has(docId)`) whenever *this* window owns the doc —
`storage-fsa.ts` states the same fact from the other side, calling "every Virgil
write is excluded by `withDocLock`" **false in the ordinary case**. So the hold is
not merely a claim about who may write; it is the thing that makes this window's
own writes cheap and unordered against peers. Drop it first and every remaining
write becomes a *real* `navigator.locks.request`, with two outcomes:

- **Dominant.** Web Locks refuses a grant while an EARLIER conflicting request is
  merely PENDING — not only while a lock is held. So one queued write is enough to
  make the peer's `{ ifAvailable: true }` claim return `null`. The user clicks
  "Move it here", the claim comes back `{owned:false}`, and (before task 596) both
  call sites answered that with `if (!result.owned) return;`. Nothing happened,
  no error, no dialog.
- **Tail.** If the peer's claim lands first it parks on `releaseSignal` and holds
  the doc for its whole open lifetime; the old owner's write queues behind it,
  lands late, and clobbers the new owner.

Note the shape, which is why it survived: the barrier was correct exactly when
there was nothing to protect (an idle doc drains to a no-op) and failed exactly
when there were unsaved edits.

**Half 1 — the ordering is inside the door.** `releaseDoc` awaits a registered
drain hook, *then* deletes `heldReleasers`. Four call sites used to hand-order
this and only `deleteFile` got it right. The hook is **injected**
(`registerDocDrain`, called once by `@/lib/storage`) rather than imported,
because `drainDoc` lives in storage and storage's FSA backend imports
`withDocLock` — importing it back closes the cycle. A drain that throws still
releases: a doc nobody can claim is worse than a write that already failed.

**Half 2 — one handoff door, and every failure speaks.**
`claimDocWithHandoff` ([src/lib/multi-window/handoff.ts](../../../src/lib/multi-window/handoff.ts))
is the whole conversation — claim, confirm, `requestHandoff`, re-claim — written
once, with the dialog injected as a narrow structural interface so it is a plain
module a test can drive. Only a *declined* confirm returns quietly; declining is
the answer. Every other false arm tells the user, including the post-confirm
re-claim failure, which stays reachable after the race is fixed (a third window
can win the doc in between).

**Half 3 — `pagehide` decides rather than inherits.** `releaseAll` drains like
every other release. A `pagehide` handler cannot await, so the drain may not
finish — but on a real unload the browser frees the lock anyway, and in the cases
where the page does NOT go away (a BFCache freeze, a `pagehide` no unload
follows) the hold is exactly what keeps those queued writes exclusive.

CI:
[doc-ownership-release-ordering.test.ts](../../../src/lib/multi-window/__tests__/doc-ownership-release-ordering.test.ts)
— jsdom has no `navigator.locks`, so `withDocLock` is a passthrough in the entire
existing suite and this class was structurally invisible to it. The suite installs
a **fake lock manager implementing the grantability rule** (a pending earlier
conflicting request disqualifies an `ifAvailable` grant) and runs two module
instances as two windows. Legs: the drain sees `ownsDoc === true` and issues zero
lock requests; a throwing drain does not strand the hold; a handoff of a doc with
an unsaved 20 ms write succeeds on the FIRST claim, with the write ordered before
the release; a refutation leg proving the fake really refuses a claim against a
pending request; `releaseAll` drains every held doc; and a CENSUS that
`@/lib/storage` is the ONE registrant — an unregistered hook drains nothing,
silently, which is the same bug in a different hat (the needle strips comments, so
a commented-out registration does not count).
Plus [handoff.test.ts](../../../src/lib/multi-window/__tests__/handoff.test.ts)
— already-owned takes no dialog; a declined confirm is silent and asks no peer; a
release timeout alerts; a post-confirm re-claim failure alerts. Neutered in four
cuts (drain after the delete, drop the registration, restore the silent return,
`releaseAll` bypassing `releaseDoc`), each of which fails its own legs.

**Owed, not claimed:** a real two-window FSA eyeball — type in window A, then in
window B open the same paper and click "Move it here"; it must move on the FIRST
click and A's last keystrokes must be on disk. Multi-window + FSA is the masked
class.

### The ORIGIN half: a fallback may supply the app-global APIs, never the POSITION (task 642)

The rule above closed the registry: `editor-actions-bridge` is a real
`Map<EditorView, Entry>` with per-key unregister, so neither MIS-ROUTE nor CLOBBER
can happen between panes. What it did not close is the **fallback** — and what the
fallback then handed over.

`registerEditorActionsHandle` has exactly ONE production call site, `EditorPane`. So
only PANES are registry keys, and every NESTED editor — a card body, a float, an
excerpt — misses the exact lookup and resolves the ACTIVE pane's handle. That is
deliberate and documented ("a nested sub-editor"). The consequence was not: the
handle then built the action's `ref` from **its own** `ed.state.selection.head`.

**A handle carries two different kinds of thing, and only one of them may fall
back.** App-global React APIs (`cardCreation`, panel routing, the create-popover
seams) belong to any live pane — falling back for those is the whole point. The
ORIGIN of the gesture (which document, which caret, which containing block) is
per-DOCUMENT, and this law's first sentence is that a per-document value resolves
by OWNER. Conflating them produced two symptoms from one cause:

- `Citation` mounts **unconditionally** in the borrowed card-body schema
  ([borrowed-schema.ts](../../../src/lib/tiptap/borrowed-schema.ts)) and
  `RichTextField` builds an editable body at the default `"card"` scope, so the
  typed `\cite{}` rule fires inside a note's body — and registered its card against
  MAIN's caret, in MAIN's pos-space, in a different document. (`\footnote` reaches
  the same path only at `"excerpt"` scope, where `includeLabelRefFootnote` is
  forced; at `"card"` scope the extension is deliberately absent, since footnotes
  cannot nest, and the rule is inert.)
- `citationRun` **re-gates** on `posBlockAllowsAction(doc, ctx.ref.pos, …)`. With a
  foreign `ref.pos` that gate asks the wrong document: a main caret parked in a
  `codeBlock` SUPPRESSED the card for a cite typed inside a card body — an orphan
  produced not by a race but by where an unrelated cursor happened to be sitting.

**The shape of the fix.** `getEditorActionsHandleFor(view)` already holds the firing
view one line before the dispatch, so the origin is never missing — only dropped.
[`runEditorAction(view, id, seed)`](../../../src/lib/actions/editor-actions-bridge.ts)
is the ONE plugin-land door: it resolves the handle and binds `view` to the
invocation as `seed.origin`, and the bridge derives every document-local field from
it through
[`resolveActionOrigin`](../../../src/lib/actions/action-origin.ts) — the SSOT the
bridge's own test imports rather than re-deriving, so fixture and production cannot
drift on the thing under test. The `Editor` for a nested view needs no new registry:
TipTap stamps `view.dom.editor = this` in `createView` for every editor it makes, so
[`owningEditor`](../../../src/lib/tiptap/owning-editor.ts) reads the back-pointer the
framework already publishes. Note the asymmetry in its fallback — a raw ProseMirror
view (test harnesses) substitutes the pane's `Editor` for the `editor` field ONLY;
positions always come from `origin.state`, which is the whole point of carrying it.

**The atom lands first, so every drop is an ORPHAN — and must say so.** The typed
rules `view.dispatch(tr)` the atom before asking for the card, on purpose (it must
land even if React is unmounted). Pre-642 every failure edge was silent: a null
handle vanished into `?.`, and `runAction`'s four early returns returned `void`.
`runAction` now returns an `ActionDispatchOutcome`
(`ran` / `no-handle` / `no-editor` / `read-only` / `no-row` / `disabled`) and the
door warns in dev on anything but `ran`, naming the action and the reason. We
surface rather than roll back — the insert is durable by design. The return value is
the seam a user-facing notice can hang off later.

CI:
[bridge-origin-nested-editor.test.ts](../../../src/lib/actions/__tests__/bridge-origin-nested-editor.test.ts)
drives the REAL typed `\cite{}` rule inside a REAL card-body editor (the extension
stack `RichTextField` builds) with a REAL registered pane handle: the atom lands in
the body, the `ActionContext` names the body's view and a position in the body's
doc, and the card is still registered with main's caret inside a `codeBlock` — plus
the non-regression pin that a cite typed in main's OWN `codeBlock` is still refused,
because 642 moved WHICH document the gate reads, not whether there is one. Neutering
`resolveActionOrigin` to ignore the origin fails exactly the two load-bearing legs.
[editor-actions-bridge.test.ts](../../../src/lib/actions/__tests__/editor-actions-bridge.test.ts)
keeps the fallback leg (it is still wanted, for the React APIs) and gains its
siblings: the origin reaches the handle, the `ref` is the firing view's position, and
a view-less legacy invocation still resolves the pane's own caret.
The leg with teeth is the CENSUS in
[action-context-honesty.test.ts](../../../src/lib/actions/__tests__/action-context-honesty.test.ts):
no production file but the bridge module may call `.runAction(` — a caller that
reaches past the door silently reinstates the foreign caret — with the complement
pinned so deleting every caller cannot go green, and the seed's `origin` member
declared as a DERIVATION SOURCE whose targets must be real `ActionContext` fields
and whose consumption by the bridge is checked.

**Owed, not claimed:** FSA-masking applies (anchor / AI-request-inbox). A real-prod
eyeball is owed — type `\cite{` inside a note card's body and confirm the citation
card anchors to the card, not to the main text.
