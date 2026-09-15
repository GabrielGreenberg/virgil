<!-- last-verified: 3a8f4892 2026-09-15 -->
<!-- derives-from: AGENTS.md#laws -->

# A NodeView owns its timers' lifetime

> **Every timer a vanilla NodeView arms is scheduled through its ONE
> [`ViewLifetime`](../../../src/lib/tiptap/view-lifetime.ts), and `destroy()` disposes
> it — so no timer can outlive the view.** A wall-clock bound is still allowed
> (the heading label's refocus keeper still expires at 250 ms), but the view's
> teardown is the OUTER bound, and a scheduling call made after disposal arms
> nothing.

This is the "release gate fails with every test passing" class (task 548, the
v0.1.104 nightly). The heading strip's label input arms a 30 ms refocus KEEPER
— something steals focus from a freshly-mounted input in its first ~250 ms (a
competing focus frame, PM's own selection sync), so for that window the input
takes it back — cleared by a 250 ms `setTimeout` and by nothing else. Task 534
rewrote `refocus-no-scroll.test.ts` to drive that input hard; when the file
finished inside the window, vitest tore jsdom down with the keeper's last ticks
still queued on Node's timer heap, and the next tick read `document` and threw
into nobody's handler. Vitest exits 1 on an unhandled error whatever the
assertions said: 11 240 passed, 2 errors, deploy SKIPPED. Load-dependent (7/7
alone, green on a re-run of the identical commit), so it presents as "the
deploy failed" over a green summary — the shape that trains people to re-run a
red gate without reading it.

Five rules it earned:

- **The keeper is not the bug, and a `typeof document` guard is not the fix.**
  The guard silences the symptom, leaves the timer running against a dead
  environment, and puts a test-shaped condition into product code. The bug is
  a timer whose OUTER bound was a wall clock rather than the view that armed it.
- **A hand-cleared handle is a per-timer obligation the next timer forgets.**
  This one input carried TWO timers plus a frame, and the same shape sat in
  five NodeView bodies (paragraph title, list title, heading label, expex block
  title + label, expex item label) — four of them with an EMPTY or absent
  `destroy()`. The scope makes the obligation structural: a NodeView that
  spells the scope cannot arm a timer the scope does not know about, and the
  census forbids a bare timer verb inside any NodeView body.
- **A frame is a timer.** `autoSizeInput`'s first measure runs in a
  `requestAnimationFrame` that reads `getComputedStyle` and `document.body`
  when it lands — the same class one helper down, invisible to a same-file
  census. A NodeView hands its lifetime in; a React field gets the platform
  frame, now cancelled by the cleanup.
- **`onDispose` is the same rule for what an edit session leaves OUTSIDE the
  view's DOM.** The paragraph and list title inputs are appended to
  `document.body` (they position over the strip), with a click-away overlay;
  a view destroyed mid-edit takes them along, and does NOT commit — the editor
  the title would be written to is the one being torn down.
- **Handles are opaque and minted by the scope.** Node returns a `Timeout`
  where the DOM returns a number, and a call made after disposal must return
  something `clear` accepts without a branch. The platform is read at CALL
  time, so a lifetime built before `vi.useFakeTimers()` still arms FAKE
  timers — the property that lets a `getTimerCount()` probe see a leak at all.

CI: [nodeview-timer-lifetime.test.ts](../../../src/lib/tiptap/__tests__/nodeview-timer-lifetime.test.ts)
drives one of every NodeView that mounts an edit input through the REAL
`buildEditorExtensions("main")` stack under fake timers, opens the input,
destroys the editor INSIDE the window, and reads the leak as a COUNT
(`vi.getTimerCount()` against the editor's own baseline) with a canary per
surface proving the probe can see the arm. **No pre-548 suite could see this**:
every one that drives these inputs ends with `editor.destroy()` in a `finally`
and asserts nothing about what is still armed, because the leaked ticks fire
after the test that could have observed them has passed. The keeper's REASON
is pinned beside it (focus taken back inside 250 ms, a steal standing after),
so a fix that quietly deleted it fails here. The leg with teeth is the CENSUS
— population DISCOVERED (every shipped file spelling `addNodeView(`), reach the
transitive closure over same-file function declarations (a list NodeView's
body is a factory one call away), allowlist EMPTY, and an exact-set pin of the
regions that own a lifetime, each of which must dispose it from a `destroy()`.
[view-lifetime.test.ts](../../../src/lib/tiptap/__tests__/view-lifetime.test.ts) pins the
scope's own contract. Measured by neutering each half in turn: the pre-548
keeper takes 3 legs, a `destroy()` that stops disposing 8, an unbounded
`autoSizeInput` frame 2.

**Stated limits.** The census sees VANILLA NodeViews; the React NodeViews
(`ReactNodeViewRenderer`) get a weaker leg — a component file that arms a timer
must also spell a cancel verb — and `FigureAnnotation`, the heading strip's
React twin, is pinned timer-free. `footnote.ts`'s `setTimeout(…, 0)` event
dispatch lives in an `appendTransaction`, not a NodeView, and is a different
class. **Owed, not claimed:** a full CI run green on the first attempt — the
whole local suite (896 files) runs with zero unhandled errors, and the leak it
guards against is now uncountable rather than merely unlikely.

### The session half: a guard that checks a container the thing is not in is DEAD

Same NodeView bodies, the state the timers were only part of (task 552). 548
named these as "the same shape in five NodeView bodies" and scoped itself to the
TIMERS; 529 recorded the vanilla editors as correct on the commit/cancel latch
and deliberately did not unify them. What was left was the SESSION, in three
shapes — the paragraph and list title strips (`editor-extensions.ts`) and the
expex example block's (`expex.ts`) — differing in where the input lives, how the
session is re-entered, how it ends, and what `update()` may repaint while it is
open. Four members, and the first is a live defect:

- **M1 — the paragraph's re-entry guard was DEAD BY CONSTRUCTION.** It read
  `titleAnnot.querySelector("input")` on a container the input never enters: the
  input is appended to `document.body`, positioned over the strip. The strip
  spans the full width, so a second click anywhere the input does not cover
  reached `enterEditMode` and appended a SECOND input, whose focus blurred the
  first; the first then committed, ran the view's render, and repainted the `+T`
  strip UNDER the still-open second input. The list carried the identical dead
  probe and was unreachable only by ACCIDENT — its click-away overlay eats the
  second click. The expex block's probe was true, because its input really is
  inside the container it checks.
- **M2** — the same dead probe gated `update()`, so a structural change landing
  mid-edit repainted the strip under the open input.
- **M3** — the paragraph deferred its blur commit 150 ms where the list
  committed immediately behind an overlay.
- **M4** — both minted a first-title uuid with a BARE `generateShortId()`, no
  collision set, where every other minter in the tree draws against the doc.

> **A session is a per-VIEW fact, not a DOM-containment fact.** The door
> ([title-edit-session.ts](../../../src/lib/tiptap/title-edit-session.ts)) holds
> `editing` and is the ONE place that flips it; the click handler asks
> `begin()` (a no-op while a session is open) and `update()` asks `editing`, so
> neither can be answered by probing a container the input may not be in.

Seven rules it earned:

- **PLACEMENT is the one thing that legitimately differs**, so it is the one
  thing the callers pass. `"body"` (paragraph, list) appends to `document.body`
  behind a full-screen click-away overlay — the untitled strip is an absolutely-
  positioned overlay of the inter-paragraph gap that fades to opacity 0 off
  hover, so an input inside it would fade with it. `"inline"` (expex) appends
  INSIDE the strip, which sits in normal flow, takes focus in a FRAME (a
  synchronous focus inside the editor DOM loses to ProseMirror's mouseup
  selection sync) and mounts NO overlay — a body overlay would paint over an
  input nested in the editor's own stacking contexts.
- **THE SESSION CLAIMS THE KEYS IT ANSWERS, and only those** — the second
  member of `claimGestureKey`'s law (task 471), whose docstring is renegotiated
  in place to say so. An open title input is the innermost transient thing on
  screen, so one press ends exactly one thing. The paragraph had been claiming
  BY HAND (a bare `stopPropagation()` on EVERY keydown), which is why only it
  was safe; its two twins claimed nothing, so Escape in either ALSO discarded an
  unsaved margin-edit session, closed a scrimless Preferences / half-typed bug
  report, and committed-or-discarded an open `NodeEditPopover`. Unifying without
  the claim would have spread that to the paragraph. And the claim is SCOPED: a
  blanket `stopPropagation` made the title strip the one field in the app where
  Cmd-S did nothing.
- **Every `window`/`document` CAPTURE listener has already run** by the time a
  body-appended input's own handler fires, so a claim from the TARGET can only
  reach the BUBBLE phase — which is, measured, where all four victims live
  (`system-dialog`'s Escape is window-BUBBLE; its capture twin handles Enter
  only, and answers `hands-off` for an out-of-frame target).
- **An unchanged value dispatches NOTHING** (task 470's zero-move rule): the
  expex committed unconditionally, so Enter on an untouched title cost a history
  entry and an autosave arm for a no-op.
- **The two endings, of which exactly one happens**, in the vanilla idiom (529):
  `end()` records the ending BEFORE the input leaves the DOM, so the blur a
  removal or a re-focus dispatches finds the session already over.
- **The mint draws against the document** (`mintDocUuid`, beside
  `ensureAnchorUuid`, which now reads it too). **Stated honestly: M4 is LATENT,
  measured, not live** — `BlockUuidBackfill` re-mints a duplicate as soon as one
  lands, so both spellings leave the SAME document and no end-to-end leg can
  tell them apart. It is still worth closing: a gesture states identity before
  dispatch and the net catches what no mechanism declared (task 320), and a mint
  that leans on the net is one net-change away from orphaning an anchored
  block's cards.
- **The population is the VANILLA strips.** Two REACT surfaces also render a
  `par-title-input` (`SourcePodNodeView`'s `+T`, `float-title-field`); neither
  can call this door — their input is JSX React owns and their re-entry is a
  `useState` flag no DOM probe was standing in for — and each already holds
  529's law in its own idiom. Named at the door, and the census is scoped to
  `addNodeView` bodies for exactly that reason, which is what keeps its
  allowlist EMPTY.

CI: [par-title-edit-session.test.ts](../../../src/lib/tiptap/__tests__/par-title-edit-session.test.ts)
drives the REAL `buildEditorExtensions("main")` stack (the 548 harness shape) over
all three strips. **No pre-552 suite could see any of this**: every one that
drives these strips opens the input ONCE and asserts what that one session does,
so a SECOND click on an already-open strip — the exact gesture the dead guard was
supposed to refuse — is unrepresentable in all of them. The leg with teeth is the
CENSUS, and it reads the SHARED `nodeViewPopulation()` at a new `literals`
setting: a census whose needle IS a quoted class wants `commentsStripped`, where
one whose needle is a symbol wants `codeOnly`, and passing the reading in keeps
both on ONE discovery rather than growing a second `matchAll(/addNodeView/)`.
Measured by neutering each half in turn: the dead re-entry guard takes 3 legs
(and `exampleBlock` PASSES, which is the accepting control — its input really is
inside the container), the `update()` probe 1, the key claim 6, the zero-move
rule 3, the overlay 2, and a strip that leaves the door 7 (paragraph) / 13
(expex), the census among them.

**Residual, stated at the site.** The overlay's mousedown claims the DEFAULT and
not propagation, so a click-away from a title input still reaches `document` and
dismisses a scrimless Preferences window, a `NodeEditPopover` and the marginalia
overflow pill. That is the POINTER axis of the same law, it is the LIST's shipped
click-away semantics which this task adopts for all three strips on the task's
own recommendation, and stopping propagation there would change what a click-away
dismisses app-wide — a decision about dismissal semantics rather than about the
session.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture, no disk), so the check is cheap and real: click a paragraph's title,
then click the strip again — one input, and the strip does not flip states.

### The test half: a TEST owns its mounts' lifetime, and a wait is a DRAIN

Same class, the harness (task 566, the v0.1.106 gate) — and the case where the
rule 548 wrote for the view was owed by the test and nobody had registered it.
`bib-authority.test.tsx` (task 558) mounts the REAL `useCitations` with
`renderHook` many times over a deliberately SLOW serialized `mutateBib` door,
and waited for each write with a 40 ms timer. Under the gate's runner a queued
mutation — or the `DOC_BIB_CHANGED_EVENT` publish the still-mounted hook adopts
via `setState` — resolved AFTER the file had finished and jsdom was gone; React
scheduled a commit on a `window` that no longer existed; vitest exited 1 on
**7 unhandled errors with all 11,663 tests passing**, and the release shipped
on a re-run of the identical commit — the habit 548's own section warns against.
16/16 green in isolation, which is what a load race looks like.

The mount was the half that should not have needed a task. Testing Library
registers its per-test `cleanup` only off a GLOBAL `afterEach`, and
`vitest.config.ts` sets no `globals: true` — so for the life of the tree NO
`render` / `renderHook` was ever unmounted by the framework. Eighty-one suites
spelled `afterEach(cleanup)` by hand; ~220 did not, and every one of them
leaked its mounts past its file. Only this suite was slow enough to lose the
race, which is why it read as one file's flake.

> **A TEST owns its mounts' lifetime, and a wait is a DRAIN, not a timer.**
> `vitest.setup.ts` registers `afterEach(cleanup)` once, for every file, off
> the `afterEach` it IMPORTS — so a mount cannot outlive its test by being
> forgotten. And a test that waits for asynchronous work waits on the QUEUE
> that holds it (`flushPrefix`), never on a wall-clock guess about scheduler
> load; the gate runner is the one place the guess is wrong.

Four rules it earned:

- **The registration is REPO-WIDE, not per file** — a per-file obligation is
  one the next suite forgets, which is exactly what ~220 suites had done. Safe
  by CENSUS rather than by hope: no suite in either silo renders in a
  `beforeAll` or keeps a mount across tests on purpose.
- **The import is lazy and GATED**: a node-env suite has no `document`, a jsdom
  suite that mounted nothing has an EMPTY body (Testing Library appends every
  container to `document.body`), and instantiating react-dom in ~250 DOM
  suites that never render a React tree would be work with no reader.
- **The slow door STAYS slow.** Its two awaits are what make the concurrency
  legs falsifiable; the fix is to wait for it correctly. `settle()` is two
  rounds of drain-plus-one-tick (the queue's tracked promise settles a
  microtask before the publish and the hook's adopt run), and an `afterEach`
  drains the doc's queue again so no write outlives the test that queued it.
- **The leg with teeth is BEHAVIOURAL, across two tests.** A canary that leaves
  a hook mounted on purpose cannot ship (it IS the unhandled error), so the
  guard mounts a hook with an armed window listener in test A and reads in
  test B that its cleanup ran and the listener is gone — measured, neutering
  the config entry fails it. Beside it the census pins the config entry, the
  imported-`afterEach` shape (`_source-scan`'s own trap: a quoted needle wants
  `commentsStripped`), and that the racing suite spells the drain and no
  wall-clock wait.

CI: [test-mount-lifetime.test.tsx](../../../src/__tests__/test-mount-lifetime.test.tsx).
**Residual, stated:** the 81 hand-spelled `afterEach(cleanup)` calls are left
in place — redundant now, harmless, and 81 files of churn for no behaviour.
The other ~45 suites that wait on a `setTimeout` guess are not converted here:
with their mounts now cleaned per test, a late timer costs a FAILED assertion
rather than an unhandled error, and each conversion needs the queue that suite
actually waits on.
