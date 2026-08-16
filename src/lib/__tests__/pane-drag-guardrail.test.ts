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
//      listeners are element-scoped under pointer capture anyway, exactly what
//      this grep is steering new code toward).
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
    "[cost: per move = pointer arithmetic + a RAF-coalesced equality-bailed translate3d write; per gesture EDGE = one geometry sweep + one React commit + one persist] Floating-window move/edge-resize — a position:fixed float, not a layout pane. MOVE: the shell is moved imperatively by `translate3d` on its own element (composite-only; React renders on edges only and JSX never sets transform — the drop-mode lift-overlay law), dock/viewport geometry is SNAPSHOT once per gesture (`readDockGeometry` + the clamp bounds) and hit-tested as pure arithmetic against `resolveDockTargetByPanelProximity`, and `setPos` + `onChange` commit ONCE on the end edge. RESIZE keeps its per-move `setPos` deliberately — a resize IS a layout change of the hosted body, so there is no composite-only representation to defer. Both take the engine's pointer invariants from `lib/pane-resize/pointer-invariants` (`isPrimaryDragStart` gates both mousedowns; `isMissedRelease` ends the gesture before reading a stray coordinate), and the body cursor is set/cleared on the edges. Task 330 — the pre-330 entry read \"per-move setPos re-renders one small float subtree\", which described the GATE and said nothing about the per-move forced-layout DOM sweep (querySelectorAll + a rect per column, plus a rect PER BAND inside the 80px dock gate) that ran interleaved with those commits. Stated precisely: the commit re-rendered THIS component and rewrote the shell inline left/top (a layout invalidation), not the hosted body — children is built by the parent render, so React's same-element bailout spares that subtree. Residual: the [cost:] tag convention this entry opens with is not yet enforced by a leg in this file the way keystroke-subscriber-guardrail enforces its own.",
  "src/components/drop-mode/controller.ts":
    "Drop-a-card placement mode — not a resize gesture: crosshair/none body cursor stamped on mode edges; the mousemove hit-tests the hovered block for the placement caret (throttled by hit-test bail), commits once on click.",
  "src/components/panel-primitives.tsx":
    "File-level conjunction of three non-divider pieces: clearStaleHover's one-shot self-removing pointermove; the card-lift threshold detector (distance check, then hands off to FloatWindow and removes itself — since task 333 it takes both engine predicates, so a swallowed mouseup tears the detector down instead of leaving it armed to pop a card out on the user's next stray movement); and the band handle's static cursor-row-resize hit-target className — the band GESTURE itself runs on usePaneResizeHandle.",
  "src/hooks/useDragPosition.ts":
    "[cost: per move = pointer arithmetic + a RAF-coalesced setPosition on one small fixed panel; per gesture EDGE = one offsetWidth/offsetHeight read] The Preferences window's drag positioner — a position:fixed dialog, not a layout pane; no persistence (position IS the session state), body cursor set/cleared on the edges. Since task 333 it takes BOTH engine predicates from lib/pane-resize/pointer-invariants (`isPrimaryDragStart` gates the mousedown; `isMissedRelease` ends the gesture through the ONE end path, which also cancels the queued frame so no stray coordinate can commit behind it) and snapshots its clamp bounds on the gesture edge in the `MoveGeometry` shape FloatingPanel introduced — the pre-333 RAF body read `panel.offsetWidth`/`offsetHeight` per frame, a forced layout inside the write path for a value that cannot change during the drag.",
  "src/hooks/useMarginEdit.ts":
    "Margin-edit guides — engine-conformant by hand: frame rect snapshotted at drag start, RAF-coalesced CSS-var writes on the editor column per frame, ONE setLiveMargins commit on release, body cursor on the edges, primary-button start gate + missed-release mid-move bail (both IMPORTED from lib/pane-resize/pointer-invariants since task 333 — this file previously hand-wrote twins of both predicates, comments and all) + window-blur failsafe closing the missed-release end edge (a release over the compiled-PDF iframe must not ghost-resume or wedge the cursor). Pre-dates the engine; its 4-side axis tables + opposite-side snap live outside the single-value PaneResizeSpec shape.",
  "src/panels/Outline/focus-band-drag.ts":
    "Focus-band edge drag (snap-to-row selection, not a pane resize): row geometry snapshotted at drag start (offsetTop reads, none per frame), RAF-coalesced transient band paint, ONE onSnapBoundary commit on the end edge; body cursor on the edges. Since task 185 it also closes the missed-release end edge the way the engine does — it shares the engine's own predicates (lib/pane-resize/pointer-invariants): primary-button start gate + an isMissedRelease(e) mid-move bail that ends before reading the stray coordinate, plus a teardown end path so unmount can't leave the stamp. Extracted out of OutlinePanel.tsx so the gesture is a testable unit.",
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
    "Flush-right tuck measure — the ONE surviving chrome RO (whether the active tab sits flush with the body's right edge is a cross-subtree sum CSS can't express); RAF-coalesced, equality-bailed boolean, parked via parkDuringLayoutGesture.",
  "library/components/LeftList.tsx":
    "Rows-viewport measure — virtualization window height; equality-bailed setState (a horizontal gutter drag doesn't change the height, so mid-drag fires bail to the same state).",
  "library/components/RightDetail.tsx":
    "textPodRect header↔pod pinning — RAF-coalesced, ±0.5px equality gate, parked via parkDuringLayoutGesture (defense-in-depth behind the PaneFreeze width lock).",
  "library/components/PaperHeader.tsx":
    "Narrow flag — boolean threshold from borderBoxSize; React bails unless the 560px line is crossed mid-gesture.",
  "library/hooks/usePgmarkPages.ts":
    "\\pgmark chip re-scan — RAF-coalesced, parked via parkDuringLayoutGesture, and the `pages` array is identity-gated (label+docY) so consumer memos (PaperRender → EditorPane) hold.",
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
    "Float move + edge resize — the reference implementation of the four bespoke-gesture obligations (task 330). Also on the chrome census above.",
  "src/components/Marginalia.tsx":
    "Marker re-anchor press watcher: a >3px movement arms `suppressClickRef` so the trailing click can't also open the panel; the drop session itself is the drop-mode controller's. Both invariants since task 333 — without the bail a swallowed mouseup left these listeners installed forever, so every later mouse movement re-armed the suppressor and the marker's click stopped opening its panel, permanently.",
  "src/components/drop-mode/controller.ts":
    "Drop-mode placement session — the ONE chokepoint every pointer-driven content drag routes through; throttled hit-test, commit once on release, `isMissedRelease` bail (with the LayoutGestureBus in the loop, a swallowed mouseup would wedge every parked follower app-wide). Also on the chrome census above.",
  "src/components/editor-layout/editor-scrollbar.tsx":
    "Scrollbar THUMB drag — the category-defining entry: it writes `row.scrollTop` per raw move and wears no drag chrome whatsoever, so the census above is structurally blind to it and it ran with ZERO pointer invariants (not even a button gate) until task 333. Now: primary-button start gate, `isMissedRelease` bail through the one end path. Its per-move write is a scroll position rather than layout state, and the browser coalesces those, so it is deliberately not RAF-gated.",
  "src/components/panel-primitives.tsx":
    "Card-lift threshold detector + clearStaleHover's one-shot pointermove. Both invariants since task 333. Also on the chrome census above.",
  "src/hooks/useDragPosition.ts":
    "The Preferences window's drag positioner — RAF-coalesced, gesture-edge geometry snapshot, both invariants. Also on the chrome census above.",
  "src/hooks/useMarginEdit.ts":
    "Margin-edit guides — engine-conformant by hand, both invariants IMPORTED since task 333. Also on the chrome census above.",
  "src/lib/tiptap/inline-atom-grab.ts":
    "Inline-atom grab: an 8px hold-threshold detector that hands the post-threshold gesture to the drop-mode controller. The bail is PRE-threshold only, which is this handler's exclusive ownership window — post-threshold the controller owns the gesture and carries its own bail, so ending it from here would commit the drop at a stale coordinate.",
  "src/panels/Outline/focus-band-drag.ts":
    "Focus-band edge drag (snap-to-row selection) — both invariants since task 185. Also on the chrome census above.",
  "src/text-objects/LiftHost.tsx":
    "The shared post-threshold lift host: overlay state, window listeners and the terminal policy for every block/text-object lift. Carries `isMissedRelease`.",
  "src/text-objects/TextObjectGrabHandle.tsx":
    "TWO listeners, and they are different animals. (a) The grab handle's hold-threshold detector — both invariants since task 333, the bail PRE-threshold only for the same reason inline-atom-grab's is (LiftHost owns the gesture after handoff). (b) A permanent `document` mousemove HOVER tracker that resolves which block the handle should point at: not a gesture, registers no release teardown, and therefore outside the invariants leg by construction.",
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
