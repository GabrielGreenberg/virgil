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
