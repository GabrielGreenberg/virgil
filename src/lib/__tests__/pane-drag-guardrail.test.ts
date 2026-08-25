// Pane-drag guardrail — the third grep-allowlist sibling (after
// keystroke-subscriber-guardrail + scroll-reposition-guardrail), covering the
// divider-gesture class from the library-UI refactor
// (MEMO_LIBRARY_UI_REFACTOR_2026_07_11 §P5; doctrine: AGENTS.md "Pane-drag
// stability" + library/AGENTS.md "Perf doctrine").
//
// The law: every pane/divider resize gesture runs on the ONE engine at
// `src/lib/pane-resize/` (`usePaneResizeHandle`) — pointer capture on the
// handle, element-scoped listeners, button gates, missed-release failsafe,
// drag shield, RAF-coalesced imperative apply(), commit-once persistence,
// edge-only LayoutGestureBus. The failure class this kills: a bespoke
// window-listener drag handler that loses its pointerup to an iframe
// (hang + ghost-resume + spurious commit), thrashes per-frame React
// state/store/localStorage, or wedges a park flag forever.
//
//   1. SOURCE-GREP ALLOWLIST — walk BOTH silos (`src/` + `library/`), flag
//      every file that pairs a WINDOW/DOCUMENT-level (incl. `document.body` /
//      `document.documentElement`) `pointermove`/`mousemove`/`touchmove`
//      listener with drag-gesture chrome (a `body.style.cursor` write or any
//      CSS resize cursor token), and assert the flagged set equals
//      `PERMITTED_WINDOW_DRAG_GESTURES`. The engine directory itself is
//      excluded (it is the one sanctioned owner of divider gestures — and its
//      listeners are element-scoped under pointer capture anyway). That
//      parenthesis used to end "…exactly what this grep is steering new code
//      toward", and task 439 retired the claim rather than leaving it standing:
//      the element-scoped shape was steered toward and NOT examined, so
//      `StripButton` took none of the four obligations for as long as it has
//      existed with every leg here green. Leg 5 below is that population.
//   2. RETIRED PRIMITIVES STAY DEAD — the pre-engine gesture plumbing
//      (library/lib/gutter-drag.ts, src/hooks/useDragGap.ts, the
//      `virgil:drag-gap-start/end` window CustomEvents) was deleted; assert no
//      live code references it again.
//
//   3. LIBRARY RESIZEOBSERVER CENSUS — every `new ResizeObserver` under the
//      library silo (`library/` + `src/components/library/`) must be on
//      `PERMITTED_LIBRARY_RESIZE_OBSERVERS` with a why-safe justification.
//      This is the CI teeth for library/AGENTS.md's census: the unparked-RO
//      class (an RO outside the PaneFreeze subtree fires per drag frame →
//      re-renders the Library tree per frame — R4/task-090) and the
//      measured-chrome class (RO → setState → SVG d-string loop) both need a
//      new RO to land, and none of the other greps sees one.
//
// Like its siblings, the grep is a heuristic — "is this gesture safe" is
// semantic — so the allowlist + per-entry justification is what makes it
// robust: a listed site is human-verified as NOT a pane divider (or as
// engine-conformant: snapshot-at-start geometry, RAF-coalesced transient
// writes, commit-once on release). A NEW unlisted window-listener drag
// gesture FAILS CI; so does a new divider that bypasses the engine, since a
// divider needs the cursor chrome OR the shared `.drag-gap`/`.band-grip`
// handle classes this grep keys on (STYLE_GUIDE's documented authoring path).

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  strip,
  tagAround,
  tagsContaining,
  elementSubtree,
} from "./_source-scan";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../library"); // the Library silo
const ENGINE_DIR = path.resolve(SRC, "lib/pane-resize"); // the ONE gesture owner

// ── The permitted window-drag-gesture allowlist ─────────────────────────────
// Repo-relative keys (silo prefix included — one list spans both silos).
// Every entry is human-verified: either it is NOT a pane divider (floats,
// modes, band selection) or its gesture already follows the engine's
// contract (geometry snapshotted at drag start, RAF-coalesced transient
// writes, ONE commit on release, cursor set/cleared on the edges, AND a
// missed-release end edge — capture, a `buttons` bit-test bail, or a blur
// failsafe — so an iframe/focus-loss can't eat the mouseup and ghost-resume
// the gesture). The library silo has NO entries — keep it that way
// (library/AGENTS.md).
const PERMITTED_WINDOW_DRAG_GESTURES: Record<string, string> = {
  "src/components/FloatingPanel.tsx":
    "[cost: per MOVE event = pointer arithmetic + a scheduled frame; per RESIZE event = clamp arithmetic + a scheduled frame, no DOM read; per coalesced FRAME = ONE equality-bailed translate3d (move) or ONE equality-bailed React setPos (resize); per gesture EDGE = one geometry sweep + one React commit + one persist] Floating-window move/edge-resize — a position:fixed float, not a layout pane. MOVE: the shell is moved imperatively by `translate3d` on its own element (composite-only; React renders on edges only and JSX never sets transform — the drop-mode lift-overlay law), dock/viewport geometry is SNAPSHOT once per gesture (`readDockGeometry` + the clamp bounds) and hit-tested as pure arithmetic against `resolveDockTargetByPanelProximity`, and `setPos` + `onChange` commit ONCE on the end edge. RESIZE re-lays-out the hosted body by construction, so there is no composite-only representation to defer — but that argues for a layout write, not for an UNCOALESCED one (the engine's own apply() writes real layout and still coalesces), which is why task 335 closed it: React stays the OWNER of width/height (JSX sets them, so an imperative write would be clobbered by any mid-gesture re-render — the fork the transform is immune to) and the coalescing sits in FRONT of the owner, one equality-bailed `commitPos` per frame through the same door the move's edges use. Both channels cancel their queued frame on the ONE end path, and the release reads `liveRect()` so a gesture whose last frame never ran still persists what the user dragged to. Both take the engine's pointer invariants from `lib/pane-resize/pointer-invariants` (`isPrimaryDragStart` gates both mousedowns; `isMissedRelease` ends the gesture before reading a stray coordinate), and the body cursor is set/cleared on the edges. Task 330 — the pre-330 entry read \"per-move setPos re-renders one small float subtree\", which described the GATE and said nothing about the per-move forced-layout DOM sweep (querySelectorAll + a rect per column, plus a rect PER BAND inside the 80px dock gate) that ran interleaved with those commits. Stated precisely: the commit re-rendered THIS component and rewrote the shell inline left/top (a layout invalidation), not the hosted body — children is built by the parent render, so React's same-element bailout spares that subtree.",
  "src/components/drop-mode/controller.ts":
    "[cost: per MOVE event = two scalar writes + a scheduling bail; ZERO DOM reads; per coalesced FRAME = ONE hitTest at the LIVE pointer (one `document.elementsFromPoint`, one `posAtCoords`, and one block-rect read threaded into the placement builders — wave-2b C8; the bar\'s horizontal extent comes from the gesture-scoped `contentSpanFor` memo since task 351) and at most one equality-bailed React placement commit; per gesture EDGE = one geometry sweep (`move-geometry.ts`), one body-cursor stamp, one commit on release] Drop-a-card placement mode — not a resize gesture, and since task 351 it takes the four bespoke-gesture obligations rather than an exemption from them. The pre-351 tag read \"per move = a 16 ms setTimeout-paced throttle gate\", which described the GATE and was silent about BOTH the sibling call in the same handler (`feedAutoScroll` opened with `scrollEl.getBoundingClientRect()` on every RAW pointer event — a forced layout at 120-240 Hz for a container that cannot move under a held pointer) and the gate\'s own fast branch (the whole hitTest ran SYNCHRONOUSLY inside the mousemove handler, interleaved with the indicator\'s React style write: read -> write -> read per frame, task 330\'s diagnosis one module over). The clock is now rAF with a setTimeout SAFETY NET behind it rather than a bare 16 ms timer: headless / inactive-tab environments throttle rAF to the point of never firing under synthetic events, so the net keeps a slow pointer\'s LAST position from being dropped, and the pass reads the live pointer at frame time rather than the coordinate that scheduled it. The one end path cancels the queued frame and disarms the snapshot. Behavioural contract: `src/components/drop-mode/__tests__/content-drag-move-cost.test.ts`.",
  "src/components/panel-primitives.tsx":
    "[cost: per move = one squared-distance compare (the card-lift threshold detector), then it hands off to FloatWindow and removes itself; clearStaleHover's pointermove is one-shot self-removing; the band handle's className is static] File-level conjunction of three non-divider pieces — the band GESTURE itself runs on usePaneResizeHandle. Since task 333 the lift detector takes both engine predicates, so a swallowed mouseup tears it down instead of leaving it armed to pop a card out on the user's next stray movement.",
  "src/hooks/useDragPosition.ts":
    "[cost: per move = pointer arithmetic + a scheduled frame; per coalesced FRAME = one setPosition on one small fixed panel; per gesture EDGE = one offsetWidth/offsetHeight read] The Preferences window's drag positioner — a position:fixed dialog, not a layout pane; no persistence (position IS the session state), body cursor set/cleared on the edges. Since task 333 it takes BOTH engine predicates from lib/pane-resize/pointer-invariants (`isPrimaryDragStart` gates the mousedown; `isMissedRelease` ends the gesture through the ONE end path, which also cancels the queued frame so no stray coordinate can commit behind it) and snapshots its clamp bounds on the gesture edge in the `MoveGeometry` shape FloatingPanel introduced — the pre-333 RAF body read `panel.offsetWidth`/`offsetHeight` per frame, a forced layout inside the write path for a value that cannot change during the drag.",
  "src/hooks/useMarginEdit.ts":
    "[cost: per move = pointer arithmetic against the drag-start frame rect + a scheduled frame; per coalesced FRAME = two CSS-var writes on the editor column (no read, no equality bail — a var write the browser already de-dupes, on ONE element); per gesture EDGE = one frame-rect snapshot + ONE setLiveMargins commit] Margin-edit guides — engine-conformant by hand: body cursor on the edges, primary-button start gate + missed-release mid-move bail (both IMPORTED from lib/pane-resize/pointer-invariants since task 333 — this file previously hand-wrote twins of both predicates, comments and all) + window-blur failsafe closing the missed-release end edge (a release over the compiled-PDF iframe must not ghost-resume or wedge the cursor). Pre-dates the engine; its 4-side axis tables + opposite-side snap live outside the single-value PaneResizeSpec shape.",
  "src/panels/Outline/focus-band-drag.ts":
    "[cost: per move = pure arithmetic against geometry snapshotted at the gesture edge (rows at mousedown; the scroll container's viewport top per container identity — task 334) plus a live scrollTop read, and a scheduled frame; per coalesced FRAME = one O(rows) nearest-row scan + one transient band paint; per gesture EDGE = the measureRows snapshot + ONE onSnapBoundary commit] Focus-band edge drag (snap-to-row selection, not a pane resize); body cursor on the edges. Since task 185 it also closes the missed-release end edge the way the engine does — it shares the engine's own predicates (lib/pane-resize/pointer-invariants): primary-button start gate + an isMissedRelease(e) mid-move bail that ends before reading the stray coordinate, plus a teardown end path so unmount can't leave the stamp. Extracted out of OutlinePanel.tsx so the gesture is a testable unit. Writing this tag is what surfaced the container `getBoundingClientRect()` it used to run PER MOVE — a forced layout in the write path for an origin that cannot move while the pointer is held, the same shape task 333 took out of useDragPosition's RAF body, and invisible to every other leg here.",
};

// ── The library ResizeObserver census ────────────────────────────────────────
// CI teeth for the census in library/AGENTS.md "Pane-drag doctrine": every
// `new ResizeObserver` under the library silo (`library/` +
// `src/components/library/`) is listed here with its why-safe justification,
// and the same facts live as a comment at the site. This is what keeps the
// unparked-RO class (R4/task-090: an RO outside the PaneFreeze subtree firing
// per drag frame → per-frame Library re-renders) and the measured-chrome
// class (RO → setState → SVG re-path) dead — neither can land without a new
// RO, and no other guardrail grep sees one. A new RO must either park via
// `parkDuringLayoutGesture` (when it could fire mid-gesture) or carry an
// equality-bail justification, in BOTH places.
const PERMITTED_LIBRARY_RESIZE_OBSERVERS: Record<string, string> = {
  "library/components/panel-tabs/PanelTabStrip.tsx":
    "[cost: per fire = a scheduled frame; per coalesced FRAME = one flush-right boolean measure behind an equality bail; ZERO fires during a layout gesture (parked)] Flush-right tuck measure — the ONE surviving chrome RO (whether the active tab sits flush with the body's right edge is a cross-subtree sum CSS can't express); parked via parkDuringLayoutGesture.",
  "library/components/LeftList.tsx":
    "[cost: per fire = one equality-bailed setState of the rows-viewport height; live during gestures BY DESIGN] Rows-viewport measure for the virtualization window. Deliberately unparked: a horizontal gutter drag cannot change the height, so mid-drag fires bail to the same state and cost one comparison.",
  "library/components/RightDetail.tsx":
    "[cost: per fire = a scheduled frame; per coalesced FRAME = one header↔pod rect pin behind a ±0.5px equality gate; ZERO fires during a layout gesture (parked)] textPodRect pinning — parkDuringLayoutGesture as defense-in-depth behind the PaneFreeze width lock.",
  "library/components/PaperHeader.tsx":
    "[cost: per fire = one boolean threshold read off the delivered borderBoxSize (no DOM read of its own); React bails unless the 560px line is crossed] Narrow flag.",
  "library/hooks/usePgmarkPages.ts":
    "[cost: per fire = a scheduled frame; per coalesced FRAME = an O(pgmarks) chip re-scan whose `pages` array is identity-gated on (label+docY), so consumer memos (PaperRender → EditorPane) hold across a no-op re-scan; ZERO fires during a layout gesture (parked)] \\pgmark chip re-scan.",
};

// ── The unchromed-resizer allowlist (task 189) ───────────────────────────────
// The POSITIVE half of the class leg above: that leg helps DETECT a bespoke
// gesture, and is structurally blind to the opposite defect — a correct engine
// gesture wearing a hand-rolled LOOK. `usePaneResizeHandle` returns
// `{ onPointerDown, style, aria-hidden, data-pane-resize-* }` and nothing
// visual, so every consumer must put `drag-gap drag-gap-{h,v} band-grip` on the
// element itself (STYLE_GUIDE "Resize gutters", and the engine's own docblock).
// A consumer that genuinely is NOT a pane gutter may wear different chrome —
// but it says so HERE, with why, and it still takes the divider family's tokens
// (`--edge-hover` / `--drag-highlight`), never a one-off accent.
// Keyed `<file>#<handle variable>` — per SITE, not per file, so a file holding
// several handles (LibraryView has three, panel-column two) can't have one of
// them exempted by a chromed sibling.
const PERMITTED_UNCHROMED_RESIZERS: Record<string, string> = {
  "library/components/LeftList.tsx#handle":
    "List-COLUMN boundary in the header row's own grid track, not a pane divider: the shared pill is 28px growing to 44px on drag and the header row is content-height (~24-28px), so `band-grip` would overflow and clip. Wears `.list-col-resizer` (library.css) — a full-track bar on the gutter family's OWN tokens (transparent → --edge-hover on :hover → --drag-highlight on the engine's .dragging class), CSS-driven, no JS hover. Adopting `band-grip` here would first require making the shared pill length-aware (clamp its long axis to the strip's extent), which is a change to chrome shared by the other nine sites and its own task.",
};

// ── The zero-move-guard allowlist (task 470) ─────────────────────────────────
// EMPTY, and it stays that way: a hit is DELETE-it.
//
// "A completed gesture that changed nothing commits nothing" is the engine's
// rule, not a consumer's. It was hand-written at six of ten `commit()`s — the
// SAME predicate (the engine px against that handle's own getValue() snapshot)
// and the SAME remedy (the function the handle already passes as `restore`) —
// and absent at the three `LibraryView` handles and `LeftList`. The three
// Library ones commit a CSS-CLAMPED rendered size, so one accidental click on
// the nav / list / papers divider on a narrow window wrote that clamped width
// into `view-session-store` permanently, forfeiting the grid template's own
// declared re-expand-on-window-grow guarantee. A rule stated identically at
// most call sites and absent at the rest is not an SSOT.
//
// The engine holds both halves it needs (`startValue`, `spec.restore`), so it
// owns the rule now — and this leg is what keeps it owned: the engine was
// never the part that could misbehave, a consumer that re-forks the guard is,
// and a re-forked guard type-checks perfectly and is invisible to every
// behavioural test of the engine (it would simply run BEFORE the engine's own
// branch and be dead code — until someone "simplified" the engine).
const PERMITTED_ZERO_MOVE_GUARDS: Record<string, string> = {};

// ── The announced-separator allowlist (task 189) ─────────────────────────────
// Empty, and that is the statement: Virgil does not yet commit to keyboard /
// screen-reader operation of its dividers (STYLE_GUIDE "Resize gutters" —
// "Accessibility posture"), so no divider may ANNOUNCE itself as one. Four
// library gutters used to carry `role="separator"` + `aria-orientation` +
// `aria-label="Resize …"` — a NAMED, valueless, non-operable splitter: an AT
// user was told a resizer existed in 4 of 10 places, told nothing in the other
// 6, and could operate none of the 15 (10 engine + 5 FloatingPanel edges). The
// half-pattern is worse than silence, so the engine emits `aria-hidden` and the
// hand-rolled roles are gone. An entry here must be a genuinely STATIC,
// non-interactive divider (the structural ARIA role) — never a resize handle;
// a resize handle earns a role by becoming focusable and arrow-operable with
// `aria-valuenow/min/max` wired from its clamp, which is the deferred half.
const PERMITTED_ANNOUNCED_SEPARATORS: Record<string, string> = {};

// ── The pointer-gesture census (task 333) ────────────────────────────────────
// The BLIND SPOT the chrome census above cannot see, and the reason it is a
// finding rather than an incidental: `detectWindowDragGesture` is a
// CONJUNCTION — a window-level move listener AND drag chrome (a body-cursor
// write, a CSS resize cursor, or the shared handle classes). A whole category
// of window drag wears none of that. A scrollbar thumb sets no cursor; a
// hold-threshold detector (the card lift, the marginalia marker re-anchor, the
// inline-atom grab, the block grab handle) is invisible until it hands off.
// Every one of those installs window `mousemove` + `mouseup` and owns a
// gesture, so every one of them owes the two pointer invariants — and four of
// them silently didn't, for as long as they have existed, with all three
// existing legs green.
//
// So this census asks the WIDER question the law actually asks: *who installs
// a window-level move listener at all?* Chrome is not part of it. Membership
// is not the finding — the two legs after it are:
//
//   INVARIANTS  — a file that also tears down from a pointer RELEASE owns a
//                 gesture, and must REFERENCE `lib/pane-resize/pointer-
//                 invariants`. Allowlist empty: a gesture without the
//                 predicates stays live after a release it never observed.
//   NO TWINS    — and it must not RE-DERIVE them. `e.button !== 0` and
//                 `(e.buttons & 1) === 0` are the two spellings the law names
//                 (AGENTS.md "Pane-drag stability": *it imports these; it does
//                 not re-derive them*). Allowlist empty; nine production sites
//                 carried a twin before task 333.
//
// Deliberately file-level, like its sibling: "is this gesture safe" is
// semantic, so the justification is what carries the verification. A file that
// merely WATCHES the pointer (a hover tracker) is a legitimate entry and says
// so; it is exempt from the invariants leg by construction, since it registers
// no release teardown.
const PERMITTED_WINDOW_POINTER_LISTENERS: Record<string, string> = {
  "src/components/FloatingPanel.tsx":
    "[cost: see the chrome-census entry — per MOVE event pointer arithmetic + a scheduled frame; per RESIZE event clamp arithmetic + a scheduled frame (coalesced since task 335)] Float move + edge resize — the reference implementation of the four bespoke-gesture obligations (task 330). Also on the chrome census above.",
  "src/components/Marginalia.tsx":
    "[cost: per move = one absolute-delta compare against the press origin + at most one ref write; no DOM read, no state commit, no frame] Marker re-anchor press watcher: a >3px movement arms `suppressClickRef` so the trailing click can't also open the panel; the drop session itself is the drop-mode controller's. Both invariants since task 333 — without the bail a swallowed mouseup left these listeners installed forever, so every later mouse movement re-armed the suppressor and the marker's click stopped opening its panel, permanently.",
  "src/components/drop-mode/controller.ts":
    "[cost: see the chrome-census entry — per move two scalar writes and a scheduling bail with ZERO DOM reads, per coalesced FRAME one hitTest at the live pointer] Drop-mode placement session — the ONE chokepoint every pointer-driven content drag routes through; commit once on release, `isMissedRelease` bail (with the LayoutGestureBus in the loop, a swallowed mouseup would wedge every parked follower app-wide). Also on the chrome census above.",
  "src/components/editor-layout/editor-scrollbar.tsx":
    "[cost: per move = one arithmetic delta + one `row.scrollTop` write; no DOM read, deliberately NOT frame-gated] Scrollbar THUMB drag — the category-defining entry: it wears no drag chrome whatsoever, so the census above is structurally blind to it and it ran with ZERO pointer invariants (not even a button gate) until task 333. Now: primary-button start gate, `isMissedRelease` bail through the one end path. The un-coalesced write is justified rather than inherited: a scroll position is state the browser itself coalesces to one paint, unlike a layout write — which is exactly the argument FloatingPanel's resize branch could not make, and why task 335 made that branch coalesce its own.",
  "src/components/panel-primitives.tsx":
    "[cost: see the chrome-census entry — per move one squared-distance compare, then handoff] Card-lift threshold detector + clearStaleHover's one-shot pointermove. Both invariants since task 333. Also on the chrome census above.",
  "src/hooks/useDragPosition.ts":
    "[cost: see the chrome-census entry — per move pointer arithmetic + a scheduled frame, one setPosition per frame] The Preferences window's drag positioner — gesture-edge geometry snapshot, both invariants. Also on the chrome census above.",
  "src/hooks/useMarginEdit.ts":
    "[cost: see the chrome-census entry — per move arithmetic + a scheduled frame, CSS-var writes per frame] Margin-edit guides — engine-conformant by hand, both invariants IMPORTED since task 333. Also on the chrome census above.",
  "src/lib/tiptap/inline-atom-grab.ts":
    "[cost: per move = one squared-distance compare until the 8px threshold; after handoff the drop-mode controller owns the pointer and this handler does nothing per event] Inline-atom grab. The bail is PRE-threshold only, which is this handler's exclusive ownership window — post-threshold the controller carries its own bail, so ending it from here would commit the drop at a stale coordinate.",
  "src/panels/Outline/focus-band-drag.ts":
    "[cost: see the chrome-census entry — per move arithmetic against gesture-edge geometry + a scheduled frame, one nearest-row scan + band paint per frame] Focus-band edge drag (snap-to-row selection) — both invariants since task 185. Also on the chrome census above.",
  "src/text-objects/LiftHost.tsx":
    "[cost: per move = one containsContentZone arithmetic test against the geometry service's cached viewport frame + a scheduled frame; per coalesced FRAME = ONE equality-bailed translate3d across the overlay's two portal nodes; React renders on EDGES only (ghost↔popout flips, document leave)] The shared post-threshold lift host: overlay state, window listeners and the terminal policy for every block/text-object lift. Carries `isMissedRelease`, and its one end path cancels the queued frame so a bailed gesture cannot commit a coordinate behind itself. The equality bail landed in task 334 — this copy of the translate channel had none while its `FloatingPanel` twin had carried one since task 330, which is the divergence that task filed: a parked cursor (a hold over a drop target, or drag auto-scroll re-running the hit-test at a still pointer) rewrote both nodes' transform per frame for a delta that had not changed. Behavioural contract: `src/text-objects/__tests__/lift-overlay-motion-cost.test.tsx`.",
  "src/text-objects/TextObjectGrabHandle.tsx":
    "[cost: per move = one squared-distance compare (the gesture half, pre-threshold); the hover tracker resolves the pointed-at block through the geometry service's cached `blocksAtY` bands, RAF-coalesced, with the legacy O(doc) `[data-uuid]` rect sweep surviving only under the `virgil:geom-hover` kill-switch] TWO listeners, and they are different animals. (a) The grab handle's hold-threshold detector — both invariants since task 333, the bail PRE-threshold only for the same reason inline-atom-grab's is (LiftHost owns the gesture after handoff). (b) A permanent `document` mousemove HOVER tracker that resolves which block the handle should point at: not a gesture, registers no release teardown, and therefore outside the invariants leg by construction.",
};

// ── The ELEMENT-scoped pointer-gesture census (task 439) ────────────────────
// The blind spot the census above cannot see, and the second time this file
// has had to be widened out of its own MECHANISM. Task 333 widened the chrome
// conjunction into "who installs a WINDOW-level move listener at all" — and
// that is still a mechanism, not the question. A held gesture written with
// React element handlers plus `setPointerCapture` installs no window listener
// whatsoever, so it is invisible to every leg above; the docblock at the top of
// this file even holds that shape up as a virtue ("its listeners are
// element-scoped under pointer capture anyway, exactly what this grep is
// steering new code toward"), i.e. the census RECOMMENDED the shape it could
// not examine. `StripButton` — the panel-rail icon drag — sat there taking
// NONE of the four obligations for as long as it has existed, with every leg
// in this file green (task 439). This is task-404's lesson verbatim: discover
// a census's population by the QUESTION, not by the MECHANISM.
//
// The question is "who owns a HELD pointer gesture", and the two element-scoped
// spellings of that are: a file that takes POINTER CAPTURE (which is the whole
// point of capture — to keep receiving a pointer the user is holding), or a
// single JSX element that pairs a press handler with a move/release handler.
// Same allowlist discipline, same `[cost: …]` tag rule, and the invariants leg
// below is shared with the window census: it is the same claim.
const PERMITTED_ELEMENT_POINTER_GESTURES: Record<string, string> = {
  "src/components/editor-layout/drag-drop.tsx":
    "[cost: per MOVE event = one absolute-delta compare against the press origin + one scalar write + a scheduling bail, with ZERO DOM reads; per coalesced FRAME = ONE equality-bailed translate3d on the ghost + ONE equality-bailed translate3d (and, only on a side crossing, a width) on the drop indicator, both resolved as pure arithmetic over the snapshot; per gesture EDGE = ONE geometry sweep (the strip resolve + a rect per icon) and ONE `onMove` commit] The strip-icon drag — a panel REORDER, not a pane resize, and the category-defining entry for this census exactly as the scrollbar thumb is for the window one: it installs no window listener at all, so the two legs above are structurally blind to it. Since task 439 it takes both invariants from `lib/pane-resize/pointer-invariants` (`isPrimaryDragStart` gates the pointerdown, so a right-press can no longer fall through `onPointerUp` and toggle the panel beside the context menu the same press opens; `isMissedRelease` ends the gesture through the ONE teardown BEFORE the event's coordinate is read, so a press whose release the button never saw can no longer be resumed by a later HOVER into a phantom drag that takes document-wide pointer capture with nothing pressed) and the other two obligations with them: the strip geometry is SNAPSHOT on the threshold edge behind a lazy `geometry()` door BOTH the hover and the release read (re-armed off the LayoutGestureBus SET channel), and the move path schedules at most one rAF whose teardown cancels it. The eased `top`/`left` on the drop indicator — a main-thread LAYOUT animation restarted on most frames of a drag through a dense strip — is retired for `transform`.",
};

/** Empty, and that is the statement: a file that owns a pointer gesture takes
 *  the two predicates from the engine's SSOT. An entry here would have to
 *  explain how a gesture survives a release it never observed. */
const PERMITTED_INVARIANT_FREE_GESTURES: Record<string, string> = {};

/** Empty likewise. A hand-written twin is the "never re-derive" half of the
 *  law (AGENTS.md "Pane-drag stability"), and it is how the four gestures task
 *  333 fixed drifted: each looked complete at its own site while agreeing with
 *  the engine on the start gate and not on the release. MIGRATE it, never list
 *  it. */
const PERMITTED_REDERIVED_INVARIANTS: Record<string, string> = {};

// ── The re-derived-key-claim allowlist (task 471) ────────────────────────────
// EMPTY, same posture as its two siblings above: a hit is IMPORT-it.
//
// `claimGestureKey` is the THIRD rule in `pointer-invariants.ts`, and it earned
// its place the way the first two did — by being absent. The engine cancelled a
// divider drag from a `window` CAPTURE Escape listener and claimed nothing, so
// ONE press also reached `useMarginEdit`'s `window` BUBBLE cancel (which drops
// every margin the user has dragged and not yet Saved) and `system-dialog`'s
// `document` CAPTURE handler (which deliberately ignores `defaultPrevented`, so
// only stopPropagation reaches it — which is why the claim is the PAIR).
//
// The rule is one line, which is exactly why it must not be copied: the value
// is in the docblock beside it — WHY a gesture outranks every other key owner,
// and the stated limit that it claims PROPAGATION and not the target, so a
// same-target same-phase listener still runs and `stopImmediatePropagation()`
// is deliberately NOT used.
const PERMITTED_REDERIVED_KEY_CLAIMS: Record<string, string> = {};

// ── The allowlist registry + the [cost: …] tag rule (task 334) ───────────────
// `keystroke-subscriber-guardrail` has enforced a `[cost: …]` prefix on every
// justification in every one of its allowlists since Wave-4 P6; this file
// carried the convention (task 330's FloatingPanel entry opens with one) and
// enforced it nowhere, so it read as a rule and was a habit. Two of the five
// pre-334 entries in the drag census, and all five ResizeObserver entries,
// described the MECHANISM and never the per-event cost — the same gate-not-
// callback shape that let `float-sync` sit on the keystroke list for a year.
//
// What the tag buys here is not tidiness. Writing one for
// `focus-band-drag.ts` is what surfaced the `getBoundingClientRect()` it ran
// PER MOVE, which no leg in this file can see: the chrome census asks who
// installs a listener, the pointer census asks whether it takes the
// invariants, and neither asks what a move COSTS. A sentence that must name
// the per-event and per-frame cost separately is the cheapest instrument that
// asks.
//
// Membership is DISCOVERED from this file's own source rather than hand-listed
// below — a hand list inside the guard that outlaws hand lists is the task-260
// defect one level up, and it would sit green while a sixth allowlist was
// added with untagged entries. `cost: false` is a real answer for a list whose
// justifications answer a different question (a LOOK, an a11y ROLE, a safety
// argument), and it must say which.
type AllowlistFacet =
  | { readonly cost: true }
  | { readonly cost: false; readonly why: string };

const ALLOWLISTS: Record<
  string,
  { readonly list: Record<string, string> } & AllowlistFacet
> = {
  PERMITTED_WINDOW_DRAG_GESTURES: {
    list: PERMITTED_WINDOW_DRAG_GESTURES,
    cost: true,
  },
  PERMITTED_LIBRARY_RESIZE_OBSERVERS: {
    list: PERMITTED_LIBRARY_RESIZE_OBSERVERS,
    cost: true,
  },
  PERMITTED_WINDOW_POINTER_LISTENERS: {
    list: PERMITTED_WINDOW_POINTER_LISTENERS,
    cost: true,
  },
  PERMITTED_ELEMENT_POINTER_GESTURES: {
    list: PERMITTED_ELEMENT_POINTER_GESTURES,
    cost: true,
  },
  PERMITTED_UNCHROMED_RESIZERS: {
    list: PERMITTED_UNCHROMED_RESIZERS,
    cost: false,
    why: "answers a LOOK question (why this handle wears different chrome), not a cost one — its gestures all run on the engine, whose per-frame cost is the engine's to state",
  },
  PERMITTED_ZERO_MOVE_GUARDS: {
    list: PERMITTED_ZERO_MOVE_GUARDS,
    cost: false,
    why: "answers a COMMIT-POLICY question (why this consumer re-derives a rule the engine owns); empty and staying that way — a hit is DELETE-it, and its gestures all run on the engine, whose per-frame cost is the engine's to state",
  },
  PERMITTED_ANNOUNCED_SEPARATORS: {
    list: PERMITTED_ANNOUNCED_SEPARATORS,
    cost: false,
    why: "answers an a11y SEMANTICS question (why this divider may announce itself); empty, and a future entry would be a static non-interactive divider with no per-event cost at all",
  },
  PERMITTED_INVARIANT_FREE_GESTURES: {
    list: PERMITTED_INVARIANT_FREE_GESTURES,
    cost: false,
    why: "answers a SAFETY question (how a gesture survives a release it never observed); empty and staying that way — a hit is MIGRATE-it",
  },
  PERMITTED_REDERIVED_INVARIANTS: {
    list: PERMITTED_REDERIVED_INVARIANTS,
    cost: false,
    why: "answers the same SAFETY question from the no-twins side; empty likewise",
  },
  PERMITTED_REDERIVED_KEY_CLAIMS: {
    list: PERMITTED_REDERIVED_KEY_CLAIMS,
    cost: false,
    why: "answers a KEY-OWNERSHIP question (why a gesture-owning file spells its own preventDefault+stopPropagation pair instead of claimGestureKey); empty likewise — a hit is IMPORT-it, and a keydown handler has no per-frame cost to state",
  },
};

/** Strip comments so doctrine prose (this repo documents the banned call
 *  forms heavily) can't read as a live gesture. Strings are KEPT: every needle
 *  in this file lives inside one (a `className`, a `role`, a cursor token).
 *
 *  Delegated to the repo's ONE scanner rather than the two-regex chain this
 *  replaced. That chain stripped BLOCK comments before LINE comments, so a
 *  `/*` inside a `//` line opened a phantom block that ran to the next `*` `/`
 *  anywhere in the file — measured at 5,575 characters swallowed out of one
 *  real source file here. For a census whose verdict is an EMPTY set, silently
 *  deleting source is the unsafe direction, and it is exactly task 202b's
 *  runaway. No needle flips today; this closes it before one does. */
export function stripComments(source: string): string {
  return strip(source, true);
}

export { tagAround, tagsContaining, elementSubtree };

/* The JSX tag scanner these censuses run on lives in the repo's ONE source
 * scanner beside `strip` — see `_source-scan.ts` for why each of its three
 * properties is load-bearing. Re-exported here because this file was its
 * first home and the pin below reads them from it. */

/**
 * The guarded class as a machine-detectable conjunction: a file that
 * (a) attaches a WINDOW- or DOCUMENT-level `pointermove`/`mousemove`/`touchmove`
 * listener — including on `document.body` / `document.documentElement`, which
 * are window-level in every way that matters to the law (the engine owns its
 * pointer via capture with ELEMENT-scoped listeners on the handle instead) —
 * and (b) carries drag-gesture chrome: a `document.body`/`documentElement`
 * cursor write, ANY CSS resize cursor token (`col`/`row`/`ns`/`ew`/`n`/`e`/`s`/
 * `w`/`ne`/`nw`/`se`/`sw`/`nesw`/`nwse`-resize), OR the shared divider handle
 * classes (`.drag-gap[-v|-h]` / `.band-grip`). The class leg is load-bearing:
 * the repo's divider cursors live in those CSS classes (globals.css) and
 * STYLE_GUIDE tells authors to style a divider with them — a bespoke divider
 * written the documented way carries no cursor token of its own, and only
 * this leg catches it. File-level on purpose — the allowlist + justification
 * closes the semantic gap.
 *
 * Each alternation is deliberately as wide as the behavior it stands for — a
 * `document.body` listener, a touch-driven divider, or a corner-resize cursor
 * are all the same class as far as the law is concerned, and a narrower regex
 * would let those idioms pass CI silently (task 187 — the same guard-narrower-
 * than-its-doctrine shape as task 169's `check-radius-tokens.mjs`).
 */
/** A file that spreads a real engine handle onto an element it renders. */
export function detectEngineConsumer(source: string): boolean {
  return /\busePaneResizeHandle\s*\(/.test(stripComments(source));
}

/** One engine handle, resolved to the element(s) its props are spread onto. */
export interface HandleSite {
  /** The `const <varName> = usePaneResizeHandle({…})` binding. */
  varName: string;
  /** Every open tag carrying `{...varName}` — normally exactly one. */
  tags: string[];
  /** Does EVERY such tag wear the shared grip chrome? */
  chromed: boolean;
}

/**
 * Every engine handle in a file, PER SITE — not per file.
 *
 * The per-file form this replaced was wrong in both directions at once. It said
 * "chromed" for a file that merely MENTIONS `band-grip` anywhere (a
 * `querySelector(".band-grip")` would do it), and — the reachable one — it let
 * a file with several handles be exempted by a single chromed sibling:
 * `LibraryView.tsx` holds three and `panel-column.tsx` two, so the original
 * `--accent` drift was catchable only by the accident that `LeftList.tsx`
 * happens to hold exactly one. Asking per spread site removes both.
 */
export function engineHandleSites(source: string): HandleSite[] {
  const src = stripComments(source);
  const names = [...src.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*usePaneResizeHandle\s*\(/g)]
    .map((m) => m[1]);
  return names.map((varName) => {
    const tags = tagsContaining(
      src,
      new RegExp(`\\{\\s*\\.\\.\\.\\s*${varName}\\s*\\}`),
    );
    return {
      varName,
      tags,
      chromed: tags.length > 0 && tags.every((t) => /\bband-grip\b/.test(t)),
    };
  });
}

/** One engine handle's `commit:` property, resolved to its parameter name and
 *  its whole body — expression-bodied (`commit: (px) => setLayout(…)`) and
 *  block-bodied (`commit: (px) => { … }`) alike, since the repo uses both. */
export interface CommitSite {
  /** The `const <varName> = usePaneResizeHandle({…})` binding. */
  varName: string;
  /** The commit callback's single parameter, as written (`px`, `delta`). */
  param: string;
  /** Everything after the `=>`, brace/paren-balanced. */
  body: string;
}

/**
 * Every engine handle's commit body in a file, PER SITE — the same per-handle
 * granularity the chrome census earned, and for the same reason: `LibraryView`
 * holds three handles and `panel-column` two, so a per-FILE answer would let
 * one drifting commit be exempted by a well-behaved sibling.
 *
 * Scanned by balancing delimiters rather than by regex: an expression body
 * (`setLayout({ navWidth: Math.round(px) })`) contains both braces and commas,
 * so a `[^,]*` or `[^}]*` cut truncates it mid-argument and the guard goes
 * blind on exactly the three sites the defect lived at.
 */
export function engineCommitSites(source: string): CommitSite[] {
  const src = stripComments(source);
  const out: CommitSite[] = [];
  const call = /\b(?:const|let)\s+(\w+)\s*=\s*usePaneResizeHandle\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(src))) {
    const varName = m[1];
    const spec = balancedFrom(src, m.index + m[0].length - 1); // at the "("
    if (!spec) continue;
    const commit = /\bcommit\s*:\s*\(\s*(\w+)\s*\)\s*=>\s*/.exec(spec);
    if (!commit) continue;
    const bodyStart = commit.index + commit[0].length;
    const body =
      spec[bodyStart] === "{"
        ? (balancedFrom(spec, bodyStart) ?? "")
        : expressionUntilComma(spec, bodyStart);
    out.push({ varName, param: commit[1], body });
  }
  return out;
}

/** The delimiter-balanced slice starting AT an opening `(`/`{`/`[`, inclusive
 *  of both ends. Null when it never closes (a truncated scan is the unsafe
 *  direction for a census whose verdict is an EMPTY set — say so instead). */
function balancedFrom(src: string, open: number): string | null {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/** An arrow's EXPRESSION body: everything up to the comma (or the object's
 *  closing brace) at depth 0. */
function expressionUntilComma(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth -= 1;
    else if (c === "}") {
      if (depth === 0) return src.slice(start, i);
      depth -= 1;
    } else if (c === "," && depth === 0) return src.slice(start, i);
  }
  return src.slice(start);
}

/** Index of the string literal's closing quote (template substitutions are
 *  irrelevant here — nothing this census reads lives inside one). */
function skipString(src: string, open: number): number {
  const quote = src[open];
  for (let i = open + 1; i < src.length; i += 1) {
    if (src[i] === "\\") {
      i += 1;
      continue;
    }
    if (src[i] === quote) return i;
  }
  return src.length;
}

/**
 * Does this commit body compare its OWN parameter for equality — i.e. re-derive
 * the engine's zero-move rule (task 470)?
 *
 * The needle is the comparison, not the remedy: every one of the six retired
 * copies was `if (px === <snapshot>) { restore(); return; }` or its `!==`
 * inverse, and a future fork could spell the remedy any way at all while the
 * predicate stays the same shape. Deliberately narrow to the commit's own
 * parameter: a commit comparing two OTHER values is answering a different
 * question and is not this rule.
 */
export function rederivesZeroMoveGuard(site: CommitSite): boolean {
  const p = site.param.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:\\b${p}\\s*[!=]==)|(?:[!=]==\\s*\\b${p}\\b)`).test(site.body);
}

/**
 * A divider that ANNOUNCES itself. Two literal JSX spellings of the role (bare
 * string, braced string) plus any `aria-orientation`, which is the half of the
 * pre-189 shape that could otherwise survive alone — and which ARIA only
 * defines on widget roles (separator, scrollbar, slider, toolbar, tablist,
 * listbox, menu, radiogroup), none of which Virgil implements operably yet. So
 * a hit is a real question either way, and the allowlist is where the answer
 * goes.
 *
 * NOT detected, stated so no reviewer over-trusts it: a computed role
 * (`role={vert ? "separator" : undefined}`, `role={ROLE_SEP}`) and a spread
 * object (`{...{ role: "separator" }}`) — the last is pinned as a fixture
 * below rather than papered over.
 */
export function detectAnnouncedDivider(source: string): boolean {
  const src = stripComments(source);
  return (
    /\brole\s*=\s*\{?\s*["']separator["']/.test(src) ||
    /\baria-orientation\s*=/.test(src)
  );
}

/** This repo's own markers for a bespoke (engine-less) drag hit-zone. */
const DRAG_ZONE_MARKER = /\bdata-(?:resize-edge|margin-guide)\b/;
const RESIZE_CURSOR =
  /\b(?:col|row|nesw|nwse|ne|nw|se|sw|ns|ew|n|e|s|w)-resize\b/;

/**
 * The bespoke twin of the announcement defect: a bare `<div>`/`<span>` drag
 * hit-zone carrying an `aria-label`. Such an element's implicit role is
 * `generic`, which ARIA PROHIBITS from being named — so the label is INERT: it
 * announces nothing while reading, to every developer after you, as an a11y
 * contract. Two live families had it (FloatingPanel's five edges; EditorPane's
 * four margin guides), neither operable by keyboard.
 *
 * A zone is recognized by this repo's own markers OR by a resize cursor in the
 * tag, and only flagged when it is a bare element with no `role` and no
 * `tabIndex` — an element that declares either has made a claim this census is
 * not entitled to second-guess.
 */
export function findInertlyLabeledDragZones(source: string): string[] {
  const src = stripComments(source);
  const candidates = new Set([
    ...tagsContaining(src, DRAG_ZONE_MARKER),
    ...tagsContaining(src, RESIZE_CURSOR),
  ]);
  return [...candidates].filter(
    (t) =>
      /^<(?:div|span)\b/.test(t) &&
      /\baria-label\s*=/.test(t) &&
      !/\brole\s*=/.test(t) &&
      !/\btabIndex\b/.test(t),
  );
}

/**
 * A window/document-level MOVE listener, chrome or no chrome — the widened
 * question of the pointer-gesture census (task 333). Same receiver set and
 * same event alternation as the conjunction below, which reads it, so the two
 * censuses can never disagree about what counts as a window-level move.
 */
export function detectWindowMoveListener(source: string): boolean {
  return WINDOW_LEVEL_MOVE.test(stripComments(source));
}

/**
 * ...and a teardown scoped to a pointer RELEASE. That is what separates a
 * GESTURE (a press the user is holding, which must survive a release it never
 * observes) from a permanent hover WATCHER, which has no release to miss and
 * therefore owes no invariants. Deliberately generous — any window/document
 * `mouseup`/`pointerup`/`touchend` registration counts, since a gesture that
 * ends some OTHER way is exactly the shape that must not slip through.
 */
export function detectPointerReleaseTeardown(source: string): boolean {
  return /(?:window|document)(?:\.body|\.documentElement)?\.addEventListener\(\s*["'](?:mouseup|pointerup|touchend)["']/.test(
    stripComments(source),
  );
}

/** Does the file take its predicates from the ONE source? */
export function referencesPointerInvariants(source: string): boolean {
  return /\bpane-resize\/pointer-invariants\b/.test(stripComments(source));
}

/** A press handler, and the two handlers that only a HELD pointer produces. */
const REACT_PRESS = /\bon(?:Pointer|Mouse)Down\s*=/;
const REACT_HOLD = /\bonPointer(?:Move|Up)\s*=/;
const POINTER_CAPTURE = /\.setPointerCapture\s*\(/;

/**
 * An ELEMENT-scoped held gesture (task 439) — the population the window census
 * above cannot reach. Two spellings, and the fragments are returned so a
 * failure names which one fired:
 *
 *  - the file takes POINTER CAPTURE, whose entire purpose is to keep receiving
 *    a pointer the user is holding;
 *  - a single JSX element pairs a press handler with a move/release handler,
 *    which is a held gesture written the React way.
 *
 * Element-scoped rather than file-scoped for the second spelling: a file where
 * one element has `onPointerDown` and an unrelated one has `onPointerUp` is
 * two independent handlers, not a gesture, and the JSX scanner reads a tag to
 * its REAL end so the repo's dominant `onPointerDown={(e) => …}` idiom cannot
 * truncate it at the arrow.
 */
export function findElementPointerGestures(source: string): string[] {
  const src = stripComments(source);
  const hits: string[] = [];
  if (POINTER_CAPTURE.test(src)) hits.push("setPointerCapture(");
  for (const tag of tagsContaining(src, REACT_PRESS)) {
    if (REACT_HOLD.test(tag)) hits.push(/^<[\w.-]*/.exec(tag)?.[0] ?? tag);
  }
  return hits;
}

export function detectElementPointerGesture(source: string): boolean {
  return findElementPointerGestures(source).length > 0;
}

/**
 * A RE-DERIVED invariant: the two spellings the law names. `button !== 0` /
 * `button === 0` is `isPrimaryDragStart` written out; `buttons & 1` and
 * `buttons === 0` are `isMissedRelease` written out (the second is the
 * subtly-wrong variant the SSOT's own docblock exists to explain — it keeps a
 * button-up drag tracking while a second button is chorded).
 *
 * Returns the offending fragments so a failure names them. Comments are
 * stripped and literals KEPT, as everywhere in this file: the drift lives in
 * code, and this repo documents the banned forms heavily.
 */
export function findRederivedInvariants(source: string): string[] {
  const src = stripComments(source);
  return [
    ...src.matchAll(
      /\bbuttons\s*&\s*1|\bbuttons\s*===?\s*0|\bbutton\s*!==?\s*0|\bbutton\s*===?\s*0/g,
    ),
  ].map((m) => m[0]);
}

/**
 * A RE-DERIVED KEY CLAIM (task 471): a `preventDefault()` + `stopPropagation()`
 * pair inside a GESTURE-SCOPED key handler, written out instead of taken from
 * `claimGestureKey`.
 *
 * Scoped to handlers registered with `window`/`document.addEventListener("keydown"|
 * "keyup", <name>)`, resolved to `<name>`'s declaration and brace-matched — NOT
 * to every `preventDefault` in a file the pointer censuses happen to name. Both
 * looser shapes were tried and both were wrong on this tree, measured:
 *
 *   - a bare proximity window over the whole file indicted four gesture files
 *     and `useMarginEdit`, on `preventDefault`s sitting near an unrelated
 *     `stopPropagation` in a DRAG handler;
 *   - adding "…and a `.key` comparison nearby" still indicted `Marginalia` and
 *     `panel-primitives`, whose hits are real key claims on a leaf `<button>`
 *     (`onKeyDown={…}` in JSX, the marginalia marker's Delete/Backspace and the
 *     card delete key). Those are COMPONENT key handlers, not gesture-scoped
 *     ones — a button that owns its own key press is not the rule this states,
 *     and `card-delete-key-door.test.ts` is where that question lives.
 *
 * The pair is the needle, and requiring BOTH is what keeps it an EMPTY set: a
 * lone `preventDefault()` is ordinary (`useMarginEdit`'s MODE-level Escape is
 * one, and a mode is deliberately not a claimant), while the pair means "this
 * press is mine and stops here" — the claim the SSOT publishes with its
 * rationale and its stated limit attached.
 *
 * Stated limit: only the `addEventListener` form with a NAMED handler is
 * resolved; an inline arrow registration would be invisible. No gesture in
 * either silo writes one today (they all need the reference back for teardown),
 * which is exactly why the form is the right key.
 */
export function findRederivedKeyClaims(source: string): string[] {
  const src = stripComments(source);
  const hits: string[] = [];
  const seen = new Set<string>();
  const reg = /(?:window|document)\.addEventListener\(\s*["']key(?:down|up)["']\s*,\s*(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = reg.exec(src))) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const decl = new RegExp(
      `\\b(?:const|let|var|function)?\\s*${name}\\s*=?\\s*(?:function\\s*)?\\(`,
    ).exec(src);
    if (!decl) continue;
    const params = balancedFrom(src, decl.index + decl[0].length - 1);
    if (!params) continue;
    const braceAt = src.indexOf("{", decl.index + decl[0].length - 1 + params.length);
    if (braceAt === -1) continue;
    const body = balancedFrom(src, braceAt);
    if (!body) continue;
    if (/\.preventDefault\s*\(/.test(body) && /\.stopPropagation\s*\(/.test(body)) {
      hits.push(`${name}: ${body.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  return hits;
}

/** The receiver + event alternation BOTH censuses key on (see the class
 *  docblock above for why each is as wide as it is). Declared once so the
 *  widened pointer-gesture census and this conjunction can never disagree
 *  about what a window-level move listener is. Stateless — no /g flag, since a
 *  shared RegExp with one would carry `lastIndex` between callers. */
const WINDOW_LEVEL_MOVE =
  /(?:window|document)(?:\.body|\.documentElement)?\.addEventListener\(\s*["'](?:pointermove|mousemove|touchmove)["']/;

export function detectWindowDragGesture(source: string): boolean {
  const src = stripComments(source);
  const windowLevelMove = WINDOW_LEVEL_MOVE.test(src);
  const dragChrome =
    /(?:body|documentElement)\.style\.cursor\s*=/.test(src) ||
    // The complete set of CSS resize cursors — `-resize\b`-anchored so a
    // token only matches as a whole cursor keyword (multi-char alternatives
    // first so backtracking never leaves e.g. `nesw` half-matched as `ne`).
    /\b(?:col|row|nesw|nwse|ne|nw|se|sw|ns|ew|n|e|s|w)-resize\b/.test(src) ||
    /\bdrag-gap(?:-v|-h)?\b|\bband-grip\b/.test(src);
  return windowLevelMove && dragChrome;
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip test + fixture trees so the guard never scans itself, and the
      // engine directory — the one sanctioned gesture owner.
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      if (full === ENGINE_DIR) continue;
      out.push(...walkSource(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Both silos, keyed repo-relative ("src/…" / "library/…"). */
function walkBothSilos(): Array<{ rel: string; source: string }> {
  const files: Array<{ rel: string; source: string }> = [];
  for (const [prefix, root] of [
    ["src", SRC],
    ["library", LIBRARY],
  ] as const) {
    for (const f of walkSource(root)) {
      files.push({
        rel: `${prefix}/${path.relative(root, f).split(path.sep).join("/")}`,
        source: readFileSync(f, "utf8"),
      });
    }
  }
  return files;
}

describe("pane-drag guardrail — source allowlist (both silos)", () => {
  const files = walkBothSilos();
  const detected = files
    .filter((f) => detectWindowDragGesture(f.source))
    .map((f) => f.rel)
    .sort();

  it("flags exactly the allowlisted window-drag gestures — no unlisted new ones", () => {
    // If this fails with an EXTRA file: a new window-listener drag gesture
    // landed. If it resizes a pane/divider, it MUST move onto
    // `usePaneResizeHandle` (src/lib/pane-resize) — do not allowlist a bespoke
    // divider. If it is genuinely not a divider (float drag, selection band,
    // placement mode), verify snapshot-at-start + RAF-coalesced writes +
    // commit-once, then add it here with that justification.
    expect(detected).toEqual(Object.keys(PERMITTED_WINDOW_DRAG_GESTURES).sort());
  });

  it("keeps the allowlist free of stale entries (every listed file still exists + still matches)", () => {
    const byRel = new Map(files.map((f) => [f.rel, f.source]));
    for (const rel of Object.keys(PERMITTED_WINDOW_DRAG_GESTURES)) {
      const source = byRel.get(rel);
      expect(source, `${rel} missing from the walk`).toBeDefined();
      expect(detectWindowDragGesture(source as string)).toBe(true);
    }
  });

  it("would flag a NEW unlisted bespoke divider (naive window-listener fixture)", () => {
    // The exact pre-refactor shape (LibraryView's makeResizeHandler / the
    // deleted useDragGap): window listeners + body col-resize cursor, no
    // capture, per-move work.
    const naiveDivider = `
      function makeResizeHandler(apply) {
        return (e) => {
          document.body.style.cursor = "col-resize";
          const onMove = (ev) => apply(ev.clientX);
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        };
      }
    `;
    expect(detectWindowDragGesture(naiveDivider)).toBe(true);
    expect(
      Object.keys(PERMITTED_WINDOW_DRAG_GESTURES).some((k) =>
        naiveDivider.includes(k),
      ),
    ).toBe(false);
  });

  it("would flag a class-styled bespoke divider (the documented .drag-gap/band-grip chrome, no cursor write of its own)", () => {
    // The most natural bypass path: copy STYLE_GUIDE's visual convention
    // ("put band-grip on a .drag-gap-{h,v} element") without the engine —
    // the cursor lives in the CSS classes, so the body-cursor/resize-token
    // legs never fire; only the handle-class leg catches this.
    const classStyledDivider = `
      export function BespokeGutter({ onResize }) {
        const onPointerDown = () => {
          const onMove = (ev) => onResize(ev.clientX);
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        };
        return h("div", {
          className: "drag-gap drag-gap-v band-grip",
          onPointerDown,
        });
      }
    `;
    expect(detectWindowDragGesture(classStyledDivider)).toBe(true);
  });

  it("would flag a document.body / documentElement listener divider (task 187 hole 1)", () => {
    // `document.body.addEventListener("pointermove", …)` and
    // `document.documentElement.addEventListener(…)` are window-level in every
    // way that matters to the law — the pre-widening regex anchored the root
    // object immediately before `.addEventListener` and missed both.
    const bodyListenerDivider = `
      export function BodyGutter({ apply }) {
        const onPointerDown = () => {
          document.body.style.cursor = "col-resize";
          document.body.addEventListener("pointermove", (ev) => apply(ev.clientX));
        };
        return h("div", { onPointerDown });
      }
    `;
    const docElDivider = `
      export function DocElGutter({ apply }) {
        const onPointerDown = () => {
          document.documentElement.addEventListener("mousemove", (ev) => apply(ev.clientX));
          document.documentElement.style.cursor = "row-resize";
        };
        return h("div", { onPointerDown });
      }
    `;
    expect(detectWindowDragGesture(bodyListenerDivider)).toBe(true);
    expect(detectWindowDragGesture(docElDivider)).toBe(true);
  });

  it("would flag a touch-driven divider (task 187 hole 2)", () => {
    // A `touchmove`-only divider was undetectable pre-widening (the move
    // alternation listed only pointermove|mousemove).
    const touchDivider = `
      export function TouchGutter({ apply }) {
        const onPointerDown = () => {
          document.body.style.cursor = "col-resize";
          window.addEventListener("touchmove", (ev) => apply(ev.touches[0].clientX));
        };
        return h("div", { onPointerDown });
      }
    `;
    expect(detectWindowDragGesture(touchDivider)).toBe(true);
  });

  it("would flag a corner-resize-cursor divider (task 187 hole 3)", () => {
    // Any CSS resize cursor is drag chrome — the pre-widening set enumerated
    // only col/row/ew/ns-resize, so a divider whose cursor was a diagonal or
    // single-axis keyword (e.g. nwse-resize) carried no recognized token.
    const cornerDivider = `
      export function CornerGutter({ apply }) {
        const onPointerDown = () => {
          const onMove = (ev) => apply(ev.clientX);
          window.addEventListener("pointermove", onMove);
        };
        return h("div", { className: "grip", style: { cursor: "nwse-resize" }, onPointerDown });
      }
    `;
    expect(detectWindowDragGesture(cornerDivider)).toBe(true);
  });

  it("does not flag the engine's own shape (element-scoped listeners under capture)", () => {
    const engineShape = `
      el.setPointerCapture(e.pointerId);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onEnd);
      mountDragShield(axis === "x" ? "col-resize" : "row-resize");
    `;
    expect(detectWindowDragGesture(engineShape)).toBe(false);
  });

  it("does not flag a file that only MENTIONS the pattern in comments", () => {
    const commentOnly = `
      // Never window.addEventListener("pointermove", …) with a
      // document.body.style.cursor = "col-resize" write — use the engine.
      export function ok() { return 1; }
    `;
    expect(detectWindowDragGesture(commentOnly)).toBe(false);
  });
});

describe("pane-drag guardrail — retired primitives stay dead", () => {
  const files = walkBothSilos();

  it("the pre-engine gesture modules stay deleted", () => {
    // library/lib/gutter-drag.ts (the module-level park flag whose single-
    // caller end edge wedged all tab-chrome observers) and
    // src/hooks/useDragGap.ts (the editor's window-listener divider family).
    expect(existsSync(path.join(LIBRARY, "lib/gutter-drag.ts"))).toBe(false);
    expect(existsSync(path.join(SRC, "hooks/useDragGap.ts"))).toBe(false);
  });

  it("no live code references the retired gutter-drag / useDragGap modules", () => {
    for (const f of files) {
      const src = stripComments(f.source);
      expect(/\bgutter-drag\b/.test(src), `${f.rel} references gutter-drag`).toBe(
        false,
      );
      expect(/\buseDragGap\b/.test(src), `${f.rel} references useDragGap`).toBe(
        false,
      );
    }
  });

  it("no live code dispatches or listens for the retired virgil:drag-gap events", () => {
    // Replaced by the LayoutGestureBus (edge-only, engine-internal begin/end).
    for (const f of files) {
      const src = stripComments(f.source);
      expect(
        /virgil:drag-gap-(?:start|end)/.test(src),
        `${f.rel} references virgil:drag-gap-start/end`,
      ).toBe(false);
    }
  });
});

describe("pane-drag guardrail — library ResizeObserver census", () => {
  const files = walkBothSilos().filter(
    (f) =>
      f.rel.startsWith("library/") ||
      f.rel.startsWith("src/components/library/"),
  );
  const detected = files
    .filter((f) => /\bnew\s+ResizeObserver\b/.test(stripComments(f.source)))
    .map((f) => f.rel)
    .sort();

  it("every ResizeObserver in the library silo is on the census allowlist — no unlisted new ones", () => {
    // If this fails with an EXTRA file: a new ResizeObserver landed in the
    // library silo. First ask whether layout can express the relationship
    // (container query, constant caps + stretchable middle — the
    // FolderTabChrome pattern); if it genuinely needs an RO, park it via
    // `parkDuringLayoutGesture` when it could fire mid-gesture, equality-bail its
    // setState, and add it here + to the library/AGENTS.md census with the
    // same justification.
    expect(detected).toEqual(
      Object.keys(PERMITTED_LIBRARY_RESIZE_OBSERVERS).sort(),
    );
  });

  it("keeps the census free of stale entries (every listed file still exists + still constructs an RO)", () => {
    const byRel = new Map(files.map((f) => [f.rel, f.source]));
    for (const rel of Object.keys(PERMITTED_LIBRARY_RESIZE_OBSERVERS)) {
      const source = byRel.get(rel);
      expect(source, `${rel} missing from the walk`).toBeDefined();
      expect(
        /\bnew\s+ResizeObserver\b/.test(stripComments(source as string)),
        `${rel} no longer constructs a ResizeObserver — drop its census entry`,
      ).toBe(true);
    }
  });
});

// ── Task 189: the engine owns the gesture, the .dragging hook and the a11y
// semantics; the CONSUMER owns the look. Both halves of that split need a
// census, because the pre-existing legs above are structurally blind to them:
// they detect a bespoke GESTURE, and a hand-rolled LOOK (or a hand-rolled
// ROLE) on a perfectly correct gesture matches none of their needles. That is
// exactly how one of ten consumers drifted onto `--accent` with JS hover and an
// inert `.dragging` class, and how four of ten grew a half-implemented ARIA
// splitter, with CI green throughout.
describe("pane-drag guardrail — engine-consumer chrome census (task 189)", () => {
  const files = walkBothSilos();
  const sites = files
    .filter((f) => detectEngineConsumer(f.source))
    .flatMap((f) =>
      engineHandleSites(f.source).map((s) => ({ ...s, rel: f.rel, key: `${f.rel}#${s.varName}` })),
    );

  it("resolves every engine handle to the element it is spread onto (the census can see)", () => {
    // Ten handles today across seven files (panel-primitives, split-editor-panes,
    // zen-margin, split-with-code, panel-column ×2, LibraryView ×3, LeftList).
    // A REMOVAL is a review prompt, not a silent shrink — update the number and
    // say which divider went. A site whose tags are empty means the tag scanner
    // stopped matching, which would make every other leg here vacuous.
    expect(sites.length).toBeGreaterThanOrEqual(10);
    for (const s of sites) {
      expect(s.tags.length, `${s.key}: no element spreads this handle`).toBeGreaterThan(0);
    }
  });

  it("every engine handle wears the shared band-grip chrome, or is an explicitly justified exception", () => {
    // EXTRA key here = a divider that spreads the engine's props and paints its
    // own look. Put `drag-gap drag-gap-{h,v} band-grip` on the element
    // (STYLE_GUIDE "Resize gutters"); allowlist ONLY a control that genuinely
    // is not a pane gutter, and even then keep it on the family's tokens and
    // let the engine's `.dragging` class drive the active state.
    const unchromed = sites.filter((s) => !s.chromed).map((s) => s.key).sort();
    expect(unchromed).toEqual(Object.keys(PERMITTED_UNCHROMED_RESIZERS).sort());
  });

  it("keeps the unchromed allowlist free of stale entries (still a handle, still unchromed)", () => {
    const byKey = new Map(sites.map((s) => [s.key, s]));
    for (const key of Object.keys(PERMITTED_UNCHROMED_RESIZERS)) {
      const site = byKey.get(key);
      expect(site, `${key} is no longer an engine handle — drop its allowlist entry`).toBeDefined();
      expect(
        site?.chromed,
        `${key} now wears band-grip — drop its allowlist entry`,
      ).toBe(false);
    }
  });

  it("no engine handle wraps a focusable node (the premise the engine's aria-hidden rests on)", () => {
    // The engine hides EVERY handle from the a11y tree. That is honest only
    // while a handle's subtree is decorative: a focusable node inside an
    // aria-hidden subtree is reachable by Tab and invisible to AT (and a
    // console error in Chrome). Today the three widened hit-targets are bare
    // divs and SplitWithCode's sync-arrow buttons are deliberately SIBLINGS of
    // the handle — nothing in the type system or the other legs says they must
    // stay that way, so this asks.
    for (const s of sites) {
      for (const tag of s.tags) {
        const source = stripComments(
          files.find((f) => f.rel === s.rel)?.source ?? "",
        );
        const subtree = elementSubtree(source, tag);
        expect(subtree, `${s.key}: could not locate the handle element's close tag`).not.toBeNull();
        expect(
          subtree ?? "",
          `${s.key}: an aria-hidden resize handle must not contain a focusable node`,
        ).not.toMatch(/<(?:button|a|input|select|textarea)\b|\btabIndex\b/);
      }
    }
  });

  it("the one allowlisted exception still takes the divider family's tokens, not a one-off accent", () => {
    // The allowlist buys a different SHAPE, never a different palette. Read
    // from the stylesheet that paints it, since the chrome moved out of the
    // component when it stopped being hand-rolled in JS. Slice from the first
    // RULE, not the first mention: the doc comment above the rules names the
    // class too, and starting there would have read (and passed on) prose.
    const css = readFileSync(path.resolve(LIBRARY, "styles/library.css"), "utf8");
    const rules = [...css.matchAll(/^\.list-col-resizer[^{]*\{[^}]*\}/gm)].map((m) => m[0]);
    expect(rules.length, "no .list-col-resizer rule block in library.css").toBeGreaterThanOrEqual(3);
    const rule = rules.join("\n");
    // Same state→color mapping as the shared pill: the family's VISIBLE hover
    // is --drag-highlight (--edge-hover is the pill's rest color, held at
    // opacity 0), and the drag state escalates rather than recolors.
    expect(rule).toMatch(/\.list-col-resizer:hover\s*\{[^}]*var\(--drag-highlight\)/);
    expect(rule).toContain(".list-col-resizer.dragging");
    // `--edge-hover` is the pill's REST value, held at opacity 0 — never a
    // color the user sees. Hovering to it (as this rule first did) is both a
    // fork of the family's mapping and ~1.35:1 on the header surface.
    expect(rule).not.toContain("var(--edge-hover)");
    // The pre-189 look: `--accent` (#7c5e3c) driven from React mouseenter,
    // with the engine's `.dragging` class unused so hover === active drag.
    expect(rule).not.toContain("var(--accent)");
    const leftList = readFileSync(path.resolve(LIBRARY, "components/LeftList.tsx"), "utf8");
    expect(stripComments(leftList)).not.toMatch(/onMouseEnter|onMouseLeave/);
  });

  it("would flag a new hand-rolled look, and a multi-handle file cannot be exempted by a chromed sibling (fixtures)", () => {
    const handRolled = `
      export function DriftingGutter() {
        const handle = usePaneResizeHandle({ id: "x", axis: "x" });
        return <div {...handle} style={{ background: "var(--accent)" }} />;
      }
    `;
    expect(detectEngineConsumer(handRolled)).toBe(true);
    expect(engineHandleSites(handRolled)).toEqual([
      { varName: "handle", tags: expect.any(Array), chromed: false },
    ]);

    // The per-file form this replaced reported this whole file as chromed.
    const mixed = `
      const good = usePaneResizeHandle({ id: "a", axis: "x" });
      const bad = usePaneResizeHandle({ id: "b", axis: "y" });
      const el = <div className="drag-gap drag-gap-v band-grip" {...good} />;
      const el2 = <div {...bad} onPointerDown={(e) => bad.onPointerDown(e)} style={{ background: "red" }} />;
    `;
    const byVar = Object.fromEntries(engineHandleSites(mixed).map((s) => [s.varName, s.chromed]));
    expect(byVar).toEqual({ good: true, bad: false });

    // A `band-grip` that is not on the handle's own tag is not chrome.
    const queryOnly = `
      const handle = usePaneResizeHandle({ id: "c", axis: "x" });
      document.querySelector(".band-grip");
      const el = <div {...handle} />;
    `;
    expect(engineHandleSites(queryOnly)[0].chromed).toBe(false);
  });
});

describe("pane-drag guardrail — zero-move commit census (task 470)", () => {
  const files = walkBothSilos();
  const sites = files
    .filter((f) => detectEngineConsumer(f.source))
    .flatMap((f) =>
      engineCommitSites(f.source).map((c) => ({ ...c, rel: f.rel, key: `${f.rel}#${c.varName}` })),
    );

  it("resolves every engine handle's commit body (the census can see)", () => {
    // Ten handles today; every one declares a commit (the spec requires it),
    // so a shortfall means the scanner stopped matching and every other leg
    // here went vacuous. An empty body is the same failure by another route:
    // the delimiter walk hit EOF without closing.
    expect(sites.length).toBeGreaterThanOrEqual(10);
    for (const c of sites) {
      expect(c.body.trim().length, `${c.key}: commit body did not resolve`).toBeGreaterThan(0);
    }
  });

  it("no consumer re-derives the zero-move rule inside its own commit()", () => {
    // EXTRA key here = a handle that compares the committed px against a start
    // snapshot. Delete the branch: the engine already refuses to call commit()
    // for a gesture with zero NET change and calls `restore()` instead, which
    // is byte-for-byte what all six retired copies did. Re-forking it is how
    // three Library handles came to be the only ones WITHOUT it.
    const forked = sites.filter(rederivesZeroMoveGuard).map((c) => c.key).sort();
    expect(forked).toEqual(Object.keys(PERMITTED_ZERO_MOVE_GUARDS).sort());
  });

  it("the census can actually see a re-forked guard (canary, both body shapes)", () => {
    // A leg whose verdict is an EMPTY set is worth exactly what its detector is
    // worth. Synthetic fixtures, not a live line — a canary must not stand on
    // the defect it guards (there is none left to stand on).
    const blockBodied = `
      const handle = usePaneResizeHandle({
        id: "x",
        axis: "x",
        getValue: () => rendered(),
        apply: (px) => write(px),
        commit: (px) => {
          if (px === startRef.current) { restoreFlex(); return; }
          persist(px);
        },
        restore: restoreFlex,
      });`;
    const expressionBodied = `
      const handle = usePaneResizeHandle({
        id: "y",
        axis: "y",
        getValue: () => rendered(),
        apply: (px) => write(px),
        commit: (px) => (px !== startRef.current ? persist({ h: Math.round(px) }) : undefined),
      });`;
    for (const src of [blockBodied, expressionBodied]) {
      const [site] = engineCommitSites(src);
      expect(site).toBeDefined();
      expect(rederivesZeroMoveGuard(site)).toBe(true);
    }

    // …and does NOT fire on a clean commit whose body merely CONTAINS a
    // comparison of other values, nor on one whose expression body carries
    // braces and commas (the three LibraryView commits' real shape — a
    // `[^,}]*` cut would truncate them and go blind).
    const clean = `
      const handle = usePaneResizeHandle({
        id: "z",
        axis: "x",
        getValue: () => rendered(),
        apply: (px) => write(px),
        commit: (px) => setLayout({ navWidth: Math.round(px) }),
        restore: () => resync(),
      });`;
    const [cleanSite] = engineCommitSites(clean);
    expect(cleanSite.body).toContain("Math.round(px)");
    expect(rederivesZeroMoveGuard(cleanSite)).toBe(false);

    const guardless = `
      const handle = usePaneResizeHandle({
        id: "w",
        axis: "y",
        getValue: () => 0,
        apply: (d) => write(d),
        commit: (delta) => {
          if (mode === "wide") onCommitWidths(widthsFor(delta));
          else onCommitWidths(narrowWidthsFor(delta));
        },
      });`;
    const [guardlessSite] = engineCommitSites(guardless);
    expect(rederivesZeroMoveGuard(guardlessSite)).toBe(false);
  });

  it("the three LibraryView handles commit the store UNGUARDED — the engine is the only thing standing between a click and a clamped write", () => {
    // The damage case, pinned at the source. These getValue()s return RENDERED
    // track sizes that the grid template's clamp() can render SMALLER than the
    // stored value; their commits are bare `setLayout(...)`. That is CORRECT
    // now and was the defect before — the difference is entirely the engine's
    // rule, so this leg exists to make a future "let's guard it locally again"
    // a conversation rather than a quiet re-fork, and to make sure the pair it
    // depends on (unguarded commit + a real restore) stays whole.
    const lib = sites.filter((c) => c.rel === "library/components/LibraryView.tsx");
    expect(lib.map((c) => c.varName).sort()).toEqual([
      "listResizeHandle",
      "navResizeHandle",
      "papersResizeHandle",
    ]);
    for (const c of lib) {
      expect(rederivesZeroMoveGuard(c), `${c.key} re-forked the guard`).toBe(false);
      expect(c.body, `${c.key} no longer commits the store`).toMatch(/setLayout\s*\(/);
    }
    // restore() is the other half: without it the engine's zero-move branch
    // does nothing and the imperative var keeps the clamped px it was dragged
    // to. Read off the file, since it is a sibling property of the commits.
    const source = files.find((f) => f.rel === "library/components/LibraryView.tsx")!.source;
    expect(stripComments(source).match(/\brestore\s*:/g) ?? []).toHaveLength(3);
  });
});

describe("pane-drag guardrail — divider a11y-announcement census (task 189)", () => {
  const files = walkBothSilos();

  it("no divider announces itself as an operable separator while none is operable", () => {
    // Virgil's recorded posture (STYLE_GUIDE "Resize gutters" →
    // "Accessibility posture"): dividers are pointer-only, so they say NOTHING
    // rather than claiming a splitter role they cannot honor. The engine emits
    // `aria-hidden` for all ten gutters — a consumer that adds a role back
    // overrides it and reinstates the half-pattern.
    const announced = files
      .filter((f) => detectAnnouncedDivider(f.source))
      .map((f) => f.rel)
      .sort();
    expect(announced).toEqual(Object.keys(PERMITTED_ANNOUNCED_SEPARATORS).sort());
  });

  it("no bespoke drag hit-zone carries an inert aria-label (a bare div is role=generic, which ARIA forbids naming)", () => {
    for (const f of files) {
      expect(
        findInertlyLabeledDragZones(f.source),
        `${f.rel} labels a bare drag hit-zone — the label is inert; use aria-hidden and keep the identity on its data- marker`,
      ).toEqual([]);
    }
  });

  it("the two bespoke hit-zone families are hidden rather than merely unlabeled (the census can see)", () => {
    // Anchors the leg above on the real files, so it can't pass because the
    // zones were deleted or renamed out from under it. Bounds are floors, not
    // exact counts: adding FloatingPanel's deliberately-omitted top edge is a
    // legitimate change and should not fail CI with an arithmetic message.
    for (const [rel, marker, floor] of [
      ["components/FloatingPanel.tsx", "data-resize-edge", 5],
      ["components/EditorPane.tsx", "data-margin-guide", 1],
    ] as const) {
      const source = stripComments(readFileSync(path.resolve(SRC, rel), "utf8"));
      const tags = tagsContaining(source, new RegExp(marker));
      expect(tags.length, `${rel}: no ${marker} zones found`).toBeGreaterThanOrEqual(floor);
      for (const t of tags) expect(t, `${rel}: ${marker} zone is not aria-hidden`).toMatch(/\baria-hidden\b/);
    }
  });

  it("would flag a hand-rolled announcement and an inert label, in the idioms this repo actually writes (fixtures)", () => {
    expect(detectAnnouncedDivider(`<div role="separator" {...handle} />`)).toBe(true);
    expect(detectAnnouncedDivider(`<div role={"separator"} {...handle} />`)).toBe(true);
    // The half-shape: orientation without the role. Undetectable before.
    expect(detectAnnouncedDivider(`<div aria-orientation="vertical" {...handle} />`)).toBe(true);
    // Known blind spots, pinned rather than papered over: a computed role and a
    // spread object. Both would need a parser, not a needle.
    expect(detectAnnouncedDivider(`<div role={vert ? "separator" : undefined} />`)).toBe(false);
    expect(detectAnnouncedDivider(`h("div", { role: "separator" })`)).toBe(false);

    // The arrow-handler idiom: `[^>]*` truncated the tag at `=>` and reported
    // clean. This is the exact shape of the four margin guides.
    const arrowIdiom = `<div data-resize-edge="left" onMouseDown={(e) => beginResize(e)} aria-label="Resize left edge" />`;
    expect(findInertlyLabeledDragZones(arrowIdiom)).toHaveLength(1);
    expect(/<[A-Za-z][^>]*data-resize-edge[^>]*>/.exec(arrowIdiom)?.[0]).not.toMatch(/aria-label/);

    // Recognized by cursor alone, with no data- marker at all.
    expect(
      findInertlyLabeledDragZones(
        `<div className="cursor-nwse-resize" onMouseDown={(e) => go(e)} aria-label="Resize corner" />`,
      ),
    ).toHaveLength(1);
    // Clean shapes: hidden, or an element that declares a real role/tabIndex.
    expect(findInertlyLabeledDragZones(`<div data-resize-edge="left" aria-hidden />`)).toHaveLength(0);
    expect(
      findInertlyLabeledDragZones(
        `<div data-resize-edge="left" role="slider" tabIndex={0} aria-label="Resize" />`,
      ),
    ).toHaveLength(0);
  });

  it("the shared scanner blanks comments without swallowing source (self-check)", () => {
    // The two-regex chain this file used to carry stripped block comments
    // first, so a `/*` inside a line comment opened a phantom block.
    const trap = [
      `// a line comment mentioning /* an unclosed block`,
      `const live = "band-grip";`,
      `/* a real block */`,
      `const alsoLive = "data-resize-edge";`,
    ].join("\n");
    const out = stripComments(trap);
    expect(out).toContain("band-grip");
    expect(out).toContain("data-resize-edge");
  });
});

// ── Task 333: the pointer-gesture census ─────────────────────────────────────
// The chrome census at the top of this file detects a bespoke DIVIDER. It is
// structurally blind to a bespoke gesture that paints no divider chrome —
// which is most of them — and that blindness is how four gestures shipped
// without the two invariants the law makes mandatory. These three legs ask the
// wider question and then ask the two that have teeth.
describe("pane-drag guardrail — pointer-gesture census (task 333)", () => {
  const files = walkBothSilos();
  const listeners = files.filter((f) => detectWindowMoveListener(f.source));

  it("censuses every window-level move listener in both silos — chrome or no chrome", () => {
    // EXTRA file = a new pointer gesture (or hover watcher) landed. Verify it
    // against the four obligations (AGENTS.md "Pane-drag stability":
    // coalesce / snapshot geometry at the gesture edge / commit once / the two
    // pointer invariants), then list it here with that justification. If it
    // resizes a pane it does not belong here at all — migrate it onto
    // `usePaneResizeHandle`.
    expect(listeners.map((f) => f.rel).sort()).toEqual(
      Object.keys(PERMITTED_WINDOW_POINTER_LISTENERS).sort(),
    );
  });

  it("every censused GESTURE takes its pointer invariants from the SSOT", () => {
    // The leg with teeth. A file that installs a window move listener AND
    // tears down from a pointer release owns a held gesture, so it must
    // reference `lib/pane-resize/pointer-invariants`. A hover WATCHER (no
    // release teardown) is exempt by construction, not by allowlist.
    const gestures = listeners.filter((f) =>
      detectPointerReleaseTeardown(f.source),
    );
    // Anchor: if the release-teardown needle ever stops matching, this leg
    // goes vacuously green while every gesture drifts. Ten of the eleven
    // censused files own a gesture (TextObjectGrabHandle owns one AND the lone
    // hover watcher, so it is counted here through its gesture half).
    expect(gestures.length).toBeGreaterThanOrEqual(10);
    const bare = gestures
      .filter((f) => !referencesPointerInvariants(f.source))
      .map((f) => f.rel)
      .sort();
    expect(bare).toEqual(Object.keys(PERMITTED_INVARIANT_FREE_GESTURES).sort());
  });

  it("no gesture-owning file RE-DERIVES the key claim (task 471)", () => {
    // The third invariant's census. POPULATION, stated precisely because it is
    // the load-bearing choice: every file a sibling census has already
    // identified as owning a held pointer gesture — the window-listener one
    // above, plus the element-scoped (pointer-capture / press+release-on-one-
    // tag) one below. Sweeping BOTH silos wholesale would be the wrong
    // population, not a stricter one: a menu, a dialog and a text field all
    // legitimately claim keys and have nothing to do with this rule, so the
    // set would never be empty and the leg would carry no signal at all.
    //
    // The engine directory is excluded by the walker, which is correct — it is
    // where the claim is CALLED, and its own suite pins the behaviour.
    const gestureOwners = files.filter(
      (f) => detectWindowMoveListener(f.source) || detectElementPointerGesture(f.source),
    );
    // Anchor: if both detectors stopped matching, this leg would go vacuously
    // green while every gesture drifted.
    expect(gestureOwners.length).toBeGreaterThanOrEqual(10);
    const offenders = gestureOwners
      .map((f) => ({ rel: f.rel, hits: findRederivedKeyClaims(f.source) }))
      .filter((f) => f.hits.length > 0);
    expect(
      Object.fromEntries(offenders.map((o) => [o.rel, o.hits])),
      "import claimGestureKey from @/lib/pane-resize/pointer-invariants instead — its docblock carries the rationale AND the stated limit",
    ).toEqual(
      Object.fromEntries(
        Object.keys(PERMITTED_REDERIVED_KEY_CLAIMS).map((k) => [k, expect.any(Array)]),
      ),
    );
  });

  it("the key-claim census can see a hand-written claim, and lets a lone preventDefault through (fixtures)", () => {
    // A leg whose verdict is an EMPTY set is worth what its detector is worth.
    const handWritten = `
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        finish("cancel");
      };
      window.addEventListener("keydown", onKeyDown, true);`;
    expect(findRederivedKeyClaims(handWritten)).toHaveLength(1);

    // `useMarginEdit`'s own MODE-level Escape: a lone preventDefault, and not
    // a gesture handler at all. It must NOT be indicted — a mode is not the
    // innermost transient thing on screen, and claiming there would be wrong.
    const lonePreventDefault = `
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      };
      window.addEventListener("keydown", onKey);`;
    expect(findRederivedKeyClaims(lonePreventDefault)).toEqual([]);

    // And a file with the pair but NO key handler at all (a pointer handler
    // stopping a click) is a different question and is not this one.
    const pointerPair = `
      const onMouseDown = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      };`;
    expect(findRederivedKeyClaims(pointerPair)).toEqual([]);

    // Nor is a POINTER handler's pair that merely SITS in a file which also
    // registers a key listener elsewhere — the shape that made the first cut
    // of this needle indict four real gesture files.
    const pointerPairInAKeyFile = `
      const onDragStart = (e: DragEvent) => { e.stopPropagation(); e.preventDefault(); };
      const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Enter") activate(); };
      window.addEventListener("keydown", onKeyDown);`;
    expect(findRederivedKeyClaims(pointerPairInAKeyFile)).toEqual([]);

    // Nor is a COMPONENT key handler on a leaf control — the shape that made
    // the SECOND cut indict `Marginalia` and `panel-primitives`. A button that
    // owns its own Delete/Backspace is answering for itself, not standing in
    // front of every other Escape owner in the app; that question lives in
    // `card-delete-key-door.test.ts`.
    const componentKeyHandler = `
      <button
        onKeyDown={(e) => {
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }
        }}
      />`;
    expect(findRederivedKeyClaims(componentKeyHandler)).toEqual([]);
  });

  it("no production file RE-DERIVES an invariant the SSOT publishes", () => {
    // The other leg with teeth, and the one the census above cannot reach: a
    // gesture can reference the SSOT for its start gate and still hand-write
    // its release bail (or vice versa) — which is precisely how `useMarginEdit`
    // sat correct-but-forked, restating the engine's reasoning verbatim in its
    // own comments. Swept over BOTH silos, not just the censused files: a
    // `button !== 0` gate on a click handler is the same re-derivation, and it
    // is where the next gesture's start gate gets copied from.
    const offenders = files
      .map((f) => ({ rel: f.rel, hits: findRederivedInvariants(f.source) }))
      .filter((f) => f.hits.length > 0);
    expect(
      Object.fromEntries(offenders.map((o) => [o.rel, o.hits])),
      "import isPrimaryDragStart / isMissedRelease from @/lib/pane-resize/pointer-invariants instead",
    ).toEqual(
      Object.fromEntries(
        Object.keys(PERMITTED_REDERIVED_INVARIANTS).map((k) => [k, expect.any(Array)]),
      ),
    );
  });

  it("would flag the four pre-333 shapes, and lets a hover watcher through (fixtures)", () => {
    // (a) A chrome-less gesture: the scrollbar thumb verbatim. The chrome
    //     census returns FALSE for it — that is the blind spot, pinned.
    const chromelessThumb = `
      const onThumbMouseDown = (e) => {
        const onMove = (mv) => { row.scrollTop = startScroll + (mv.clientY - startY) * ratio; };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      };
    `;
    expect(detectWindowDragGesture(chromelessThumb)).toBe(false);
    expect(detectWindowMoveListener(chromelessThumb)).toBe(true);
    expect(detectPointerReleaseTeardown(chromelessThumb)).toBe(true);
    expect(referencesPointerInvariants(chromelessThumb)).toBe(false);

    // (b) A hold-threshold detector: a gesture until it hands off, and the
    //     shape that pops a card out on a stray move after a swallowed
    //     mouseup. Same three answers as (a) — it is the same category.
    const thresholdDetector = `
      const onMove = (ev) => {
        if (triggered) return;
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (dx * dx + dy * dy < THRESHOLD * THRESHOLD) return;
        triggered = true;
        popOut();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    `;
    expect(detectWindowMoveListener(thresholdDetector)).toBe(true);
    expect(detectPointerReleaseTeardown(thresholdDetector)).toBe(true);

    // (c) Both re-derivation spellings, including the subtly-wrong
    //     `buttons === 0` the SSOT's docblock exists to warn about.
    expect(findRederivedInvariants(`if (e.button !== 0) return;`)).toEqual(["button !== 0"]);
    expect(findRederivedInvariants(`if ((mv.buttons & 1) === 0) onUp();`)).toEqual(["buttons & 1"]);
    expect(findRederivedInvariants(`if (e.buttons === 0) end();`)).toEqual(["buttons === 0"]);
    // A file that IMPORTS them re-derives nothing.
    expect(
      findRederivedInvariants(
        `import { isMissedRelease } from "@/lib/pane-resize/pointer-invariants";
         if (isMissedRelease(mv)) return;`,
      ),
    ).toEqual([]);
    // Prose naming the banned form is not a re-derivation (comments stripped).
    expect(findRederivedInvariants(`// never write button !== 0 by hand`)).toEqual([]);

    // (d) A permanent hover tracker: censused as a listener, exempt from the
    //     invariants leg because it has no release to miss.
    const hoverWatcher = `
      document.addEventListener("mousemove", onMouseMove);
      return () => document.removeEventListener("mousemove", onMouseMove);
    `;
    expect(detectWindowMoveListener(hoverWatcher)).toBe(true);
    expect(detectPointerReleaseTeardown(hoverWatcher)).toBe(false);
  });
});

describe("pane-drag guardrail — element-scoped pointer-gesture census (task 439)", () => {
  const files = walkBothSilos();
  const gestures = files.filter((f) => detectElementPointerGesture(f.source));

  it("censuses every element-scoped HELD gesture in both silos", () => {
    // EXTRA file = a gesture written with pointer capture or a press+hold
    // handler pair landed. Verify it against the four obligations (AGENTS.md
    // "Pane-drag stability") and list it above with that justification. If it
    // resizes a pane it does not belong here at all — migrate it onto
    // `usePaneResizeHandle`, which is the one sanctioned owner and is excluded
    // from this walk by directory.
    expect(gestures.map((f) => f.rel).sort()).toEqual(
      Object.keys(PERMITTED_ELEMENT_POINTER_GESTURES).sort(),
    );
  });

  it("every element-scoped gesture takes its pointer invariants from the SSOT", () => {
    // The leg with teeth, and the same claim the window census's invariants
    // leg makes — so it shares that list, which is EMPTY and stays that way.
    // Unlike the window census there is no hover-WATCHER exemption to carve
    // out: a permanent hover tracker takes no pointer capture and pairs no
    // press handler with a release, so it is outside this population by
    // construction rather than by a second predicate.
    expect(gestures.length).toBeGreaterThanOrEqual(1);
    const bare = gestures
      .filter((f) => !referencesPointerInvariants(f.source))
      .map((f) => f.rel)
      .sort();
    expect(bare).toEqual(Object.keys(PERMITTED_INVARIANT_FREE_GESTURES).sort());
  });

  it("would flag the pre-439 StripButton, and lets a lone press handler through (fixtures)", () => {
    // (a) The pre-439 shape verbatim: React handlers + pointer capture, no
    //     window listener anywhere. Both legs above return FALSE for it — that
    //     is the blind spot, pinned.
    const preFix = `
      const onPointerDown = (e) => { pointerStart.current = { x: e.clientX, y: e.clientY }; };
      const onPointerMove = (e) => {
        if (!pointerStart.current) return;
        btnRef.current?.setPointerCapture(e.pointerId);
      };
      return (
        <button
          ref={btnRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      );
    `;
    expect(detectWindowMoveListener(preFix)).toBe(false);
    expect(detectWindowDragGesture(preFix)).toBe(false);
    expect(detectElementPointerGesture(preFix)).toBe(true);
    expect(referencesPointerInvariants(preFix)).toBe(false);
    // Both spellings fire independently, so dropping either one still flags it.
    expect(findElementPointerGestures(preFix)).toEqual(
      expect.arrayContaining(["setPointerCapture(", "<button"]),
    );

    // (b) The inline-arrow idiom this repo actually writes — the tag scanner
    //     must read to the tag's REAL end, not to the first `>` inside the
    //     arrow body, or the conjunction is invisible.
    const inlineArrows = `
      <div
        onPointerDown={(e) => begin(e)}
        onPointerUp={(e) => (e.clientY > 0 ? end(e) : null)}
      />
    `;
    expect(detectElementPointerGesture(inlineArrows)).toBe(true);

    // (c) A lone press handler is a CLICK, not a held gesture.
    expect(detectElementPointerGesture(`<button onPointerDown={toggle} />`)).toBe(false);
    // …and two unrelated elements each carrying one half are not a gesture
    //    either — this population is per ELEMENT.
    expect(
      detectElementPointerGesture(
        `<div onPointerDown={a} /><span onPointerUp={b} />`,
      ),
    ).toBe(false);

    // (d) Prose naming the shape is not the shape (comments stripped).
    expect(
      detectElementPointerGesture(
        `// never call setPointerCapture( without the invariants`,
      ),
    ).toBe(false);
  });
});

// ── Task 334: the cost-class tag leg ─────────────────────────────────────────
// The sibling `keystroke-subscriber-guardrail` has enforced this on its own
// allowlists since Wave-4 P6. See the registry above for why the membership
// half is discovered from source rather than listed.
describe("pane-drag guardrail — cost-class tags (task 334)", () => {
  const ownSource = readFileSync(fileURLToPath(import.meta.url), "utf8");

  it("every justification in every COST allowlist begins with a [cost: …] tag", () => {
    for (const [name, entry] of Object.entries(ALLOWLISTS)) {
      if (!entry.cost) continue;
      for (const [key, justification] of Object.entries(entry.list)) {
        expect(
          /^\[cost: [^\]]+\]/.test(justification),
          `${name}["${key}"] justification must start with a [cost: …] tag naming the per-EVENT cost and, where the site coalesces, what one FRAME writes — "RAF-coalesced" alone does not qualify, the same rule keystroke-subscriber-guardrail applies to its own lists`,
        ).toBe(true);
      }
    }
  });

  it("a non-cost allowlist states WHY it answers a different question", () => {
    // The escape hatch is a decision someone makes on purpose, not a silent
    // omission: `cost: false` with no reason would let a real per-event
    // census walk out of the tag rule by relabelling itself.
    for (const [name, entry] of Object.entries(ALLOWLISTS)) {
      if (entry.cost) continue;
      expect(entry.why.length, `${name} must say why it is not a cost list`).toBeGreaterThan(20);
    }
  });

  it("the registry names EVERY allowlist declared in this file (discovered, not hand-listed)", () => {
    // A hand list inside the guard that outlaws hand lists is the task-260
    // defect one level up. Read our own source: any
    // `const PERMITTED_*: Record<string, string>` must be registered above,
    // so a sixth allowlist cannot land untagged and unnoticed.
    const declared = [
      ...stripComments(ownSource).matchAll(
        /\bconst\s+(PERMITTED_\w+)\s*:\s*Record<\s*string\s*,\s*string\s*>/g,
      ),
    ].map((m) => m[1]);
    expect(declared.length, "the declaration scan found nothing — it has stopped matching").toBeGreaterThanOrEqual(5);
    expect([...new Set(declared)].sort()).toEqual(Object.keys(ALLOWLISTS).sort());
  });

  it("would flag an untagged entry and a mechanism-only tag (fixtures)", () => {
    // The pre-334 shape: a justification that describes the mechanism and
    // never the cost.
    const untagged =
      "Drop-a-card placement mode — not a resize gesture: crosshair body cursor on mode edges, commits once on click.";
    expect(/^\[cost: [^\]]+\]/.test(untagged)).toBe(false);
    // An EMPTY tag is not a tag.
    expect(/^\[cost: [^\]]+\]/.test("[cost: ] whatever")).toBe(false);
    // A well-formed one passes.
    expect(
      /^\[cost: [^\]]+\]/.test(
        "[cost: per move = one compare; per FRAME = one equality-bailed write] …",
      ),
    ).toBe(true);
  });
});
