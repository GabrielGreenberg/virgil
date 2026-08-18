/**
 * Drop-mode controller. Module-level state + window listeners that own
 * the gesture from "mousedown on a producer" to drop or cancel. Follows
 * the `card-lift.ts` pattern: producers and consumers (Indicator,
 * DropModeProvider) communicate via a shared signal instead of React
 * context, since they live in unrelated subtrees.
 *
 * Producers (each calls `beginDropSession`): the card drop button
 * (`CardDropButton` → `beginCardDropGesture`, shared by the docked card
 * header + the float-chrome button), the in-text inline-atom grab, the
 * lifted-overlay grab handle, and the stack-pull thumbnail. (The legacy
 * Shift-mousedown-on-a-FloatingPanel-header entry was retired in req-7.)
 *
 * Public API:
 *   - `registerDropCtx(token, ctx)` — called by each mounted
 *     `DropModeProvider` (one per `EditorPane`) to publish ITS OWN
 *     per-doc hook bag; returns a dispose that removes only that
 *     entry. `setDropCtx(ctx | null)` is the view-less legacy publish.
 *   - `lookupSpec(kind)` — registry-aware spec lookup.
 *   - `beginDropSession({...})` — called from a producer's mousedown.
 *     Installs window listeners and a CSS hook.
 *   - `useDropSession()` — React hook for components that need to react
 *     to the current placement (Indicator).
 *
 * Cancellation is idempotent and routes through `endDropSession()`.
 */

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { pickActiveByEditor } from "@/lib/active-editor-probe";
import type { DropCtx, DropSession, DropSpec, Placement } from "./types";
import { hitTest, isUnmintedParagraphId, mintPlacementUuid } from "./hit-test";
import { resolveSessionPlacements } from "./placement-policy";
import { lookupSpec } from "./registry";
import { parseAnyKey } from "@/floats/float-key";
// The content-gesture publisher pair is imported from the bus MODULE, not the
// pane-resize barrel — it is publisher-only API (kind pinned to "content"
// inside the bus so no caller can fake a pane/window edge), and this
// controller is its one legitimate importer: the single chokepoint every
// pointer-driven content drag already routes through.
import {
  beginContentGesture,
  endContentGesture,
} from "@/lib/pane-resize/layout-gesture-bus";
import { isMissedRelease } from "@/lib/pane-resize/pointer-invariants";
import { feedAutoScroll, stopAutoScroll } from "./auto-scroll";
import {
  armMoveGeometry,
  disarmMoveGeometry,
  readMoveGeometry,
} from "./move-geometry";
import { findEditorScrollFor } from "@/components/editor-layout/layout-scroll";

// ── Per-doc context: a REGISTRY, not a single slot ───────────────────
//
// The original design parked ONE `DropCtx` in a module-level cell under the
// premise "called once by EditorPane". Multi-doc keep-alive (default ON,
// capacity 3) falsified that: N `EditorPane`s render at once (one visible, the
// rest `display:none`), each mounting its own `DropModeProvider`, and the
// Library Reader mounts the same component again. A single slot produced two
// bugs, and both are the exact pair `editor-actions-bridge.ts` names:
//   (1) MIS-ROUTE — whichever pane mounted LAST owned the slot, and a warm
//       switch is a `display:none` flip, not a remount, so ownership never
//       moved. Every doc-scoped read (`ctx.mainEditor` for `main-only` hit
//       tests, the panel hook bags, `closePopout`, `requestAnchorFlush`)
//       addressed the WRONG document: no bar painted anywhere and the release
//       did nothing. Worse for `inlineAtomMoveSpec`, whose create branch read
//       `atomAttrsFor` off the other doc's footnote hook and landed an EMPTY
//       `\footnote{}` (the task-233 shape).
//   (2) CLOBBER — the unmount cleanup wrote `null` UNCONDITIONALLY, so an
//       evicted/closed background pane (or a Library-reader round trip)
//       disarmed drag-and-drop app-wide until some pane mounted fresh.
//
// The fix is the shape its two siblings already have: `target-registry.ts`
// keys editors by DOM identity with an identity-guarded dispose, and
// `editor-actions-bridge.ts` keys handles by `editor.view`. Here the key is the
// PROVIDER INSTANCE (a token it mints once), because a provider registers while
// its `mainEditor` may still be null — the ctx's own getter resolves it later.
// Each entry is removed only by its own owner, so a departing pane can never
// disarm a pane it doesn't own.

/** A registered ctx plus the token that owns it. */
interface CtxEntry {
  token: object;
  ctx: DropCtx;
}

/**
 * Sentinel owner for the view-less legacy `setDropCtx` publish — one shared
 * slot for producers (and test harnesses) that hold no provider token.
 */
const DEFAULT_TOKEN: object = { legacy: "drop-ctx:default" };

const ctxRegistry = new Map<object, CtxEntry>();

/**
 * Publish this provider's per-doc ctx under its own key. Returns the dispose
 * the provider's effect cleanup calls: it removes ONLY this entry (guarded on
 * identity, so a re-register that already replaced it is not undone), and
 * cancels a live drop session ONLY when that session was started under this
 * entry.
 *
 * The cancel-on-unmount half is load-bearing and predates the registry: if the
 * editor a gesture is running in unmounts mid-drag (route change, a card-body
 * float closing), `InlineAtomGrab`-style sessions have `externalCommit` and so
 * no mouseup of the controller's own to fall back on — the body CSS hooks
 * (`data-drop-mode-active`, the crosshair cursor, and the global
 * `user-select:none` keyed on that attr) would stay stuck with nothing left to
 * clear them, turning the whole document unselectable. What the registry
 * changes is its SCOPE: an unrelated pane unmounting no longer kills a gesture
 * running in the visible one.
 */
export function registerDropCtx(token: object, ctx: DropCtx): () => void {
  ctxRegistry.set(token, { token, ctx });
  return () => {
    const entry = ctxRegistry.get(token);
    if (!entry || entry.ctx !== ctx) return; // already replaced — not ours to remove
    ctxRegistry.delete(token);
    if (session && session.ctx === ctx) cancelDropSession();
  };
}

/**
 * Legacy view-less publish: park a single ctx in the shared default slot (or
 * clear it with `null`). Retained for producers and harnesses that hold no
 * provider token; production registers per provider.
 */
export function setDropCtx(ctx: DropCtx | null) {
  if (ctx) {
    ctxRegistry.set(DEFAULT_TOKEN, { token: DEFAULT_TOKEN, ctx });
    return;
  }
  const entry = ctxRegistry.get(DEFAULT_TOKEN);
  ctxRegistry.delete(DEFAULT_TOKEN);
  if (entry && session && session.ctx === entry.ctx) cancelDropSession();
}

/**
 * The ACTIVE ctx — for a caller with no editor in hand. Today its callers are
 * `getDropCtxFor`'s fallback and the drop-mode suites; it stays exported as the
 * documented React-land door (the sibling of `getDropSession`), not because
 * production reads it.
 *
 * Resolution:
 *   - 0 entries → null;
 *   - 1 entry → that one, WHATEVER its editor looks like. This rung is the
 *     caller's, deliberately kept out of `pickActiveByEditor`: a sole pane with
 *     a not-yet-created (or Reader-mode absent) `mainEditor` must still resolve,
 *     and every hand-built test fixture leans on it;
 *   - N entries → the FOCUSED-then-VISIBLE pane via `pickActiveByEditor` (the
 *     same precedence the dev probes and the editor-actions bridge use); if
 *     genuinely ambiguous, the legacy default slot if present, else `null`
 *     (don't guess). NEVER "whichever was written last" — that was the bug.
 */
export function getDropCtx(): DropCtx | null {
  if (ctxRegistry.size === 0) return null;
  if (ctxRegistry.size === 1) {
    return ctxRegistry.values().next().value?.ctx ?? null;
  }
  const picked = pickActiveByEditor(ctxRegistry.values(), (e) => e.ctx.mainEditor);
  if (picked) return picked.ctx;
  return ctxRegistry.get(DEFAULT_TOKEN)?.ctx ?? null;
}

/**
 * EXACT lookup: the ctx whose `mainEditor` IS this editor, falling back to the
 * active ctx. The entrypoint for a producer that knows which document its
 * gesture started in (the in-text inline-atom grab and the lifted-overlay grab
 * both fire from inside a specific editor) — correct even with two panes
 * visible at once, where the ladder above can only guess.
 */
export function getDropCtxFor(editor: Editor | null | undefined): DropCtx | null {
  if (editor) {
    for (const entry of ctxRegistry.values()) {
      if (entry.ctx.mainEditor === editor) return entry.ctx;
    }
  }
  return getDropCtx();
}

/** TEST-ONLY: drop every entry (per-provider + the legacy slot). */
export function __resetDropCtxRegistry(): void {
  ctxRegistry.clear();
}

// ── Active session signal ────────────────────────────────────────────

let session: DropSession | null = null;
const sessionListeners = new Set<() => void>();

function emitSession() {
  sessionListeners.forEach((l) => l());
}

export function getDropSession(): DropSession | null {
  return session;
}

/** Subscribe a React component to session changes. */
export function useDropSession(): DropSession | null {
  const [s, setS] = useState<DropSession | null>(session);
  useEffect(() => {
    const sub = () => setS(getDropSession());
    sessionListeners.add(sub);
    sub();
    return () => {
      sessionListeners.delete(sub);
    };
  }, []);
  return s;
}

// ── Lifecycle ────────────────────────────────────────────────────────

/**
 * Begin a drop session from a producer's mousedown (the card drop
 * button, the in-text inline-atom grab, the lifted-overlay grab handle,
 * or the stack-pull thumbnail). Looks up the spec from `cardKey`; no-ops
 * if no spec is registered for the kind, so a producer is harmless until
 * its spec lands.
 *
 * `inPlace` skips the float-dimming branch (`markSourceFloat`) — used
 * by the lifted-overlay gesture, where no popout exists to dim.
 * `externalCommit` skips installing the controller's own mouseup
 * listener; the caller drives commit/cancel via `commitDropSession()`
 * / `cancelDropSession()`. Used when the gesture owns mouseup and
 * decides commit-vs-cancel per its own mode (lifted-overlay ghost vs
 * popout).
 *
 * `editor` is an optional EXACT pane hint: the editor the gesture fired
 * in. Producers that have one (the in-text atom grab, the lifted-overlay
 * grab) pass it so the session binds to that document by construction
 * rather than by the visible-pane ladder; the rest resolve through
 * `getDropCtx()`.
 *
 * Returns true if a session was started, false if rejected (no spec,
 * another session active, or no DropCtx registered).
 */
export function beginDropSession(opts: {
  cardKey: string;
  origin: { x: number; y: number };
  inPlace?: boolean;
  externalCommit?: boolean;
  editor?: Editor | null;
}): boolean {
  if (session) return false; // first gesture wins
  // Resolve the ctx ONCE, here, and carry it on the session for its whole
  // life: `ctx.mainEditor` then means "the document this gesture started in"
  // BY CONSTRUCTION, which is the invariant every consumer already assumed and
  // a module-level "current" could not deliver. It also makes the gesture
  // immune to a pane mounting, unmounting, or gaining focus mid-drag.
  const ctx = getDropCtxFor(opts.editor);
  if (!ctx) return false;
  // `parseAnyKey` reads both the `float:` grammar and legacy/transient keys.
  const parsed = parseAnyKey(opts.cardKey);
  if (!parsed) return false;
  const kind = parsed.kind;
  // `lookupSpec` takes the FULL cardKey: most kinds dispatch on the kind, but
  // `linkedRange` routes to the text-range-move spec (a plain selection moves
  // as a slice, not a block) — L3f-2.
  const spec = lookupSpec(opts.cardKey);
  if (!spec) return false;

  const inPlace = opts.inPlace === true;
  session = {
    cardKey: opts.cardKey,
    kind,
    spec,
    ctx,
    // Resolve the payload-aware placement list ONCE, here (task 258): the
    // resolution may read persisted state (stack-pull parses its localStorage
    // envelope), a cost the throttled per-move hit-test must never pay, and
    // freezing the CHOICE at mousedown keeps the affordance stable. The payload
    // can still vanish mid-drag, which `classifyDrop` re-checks at commit.
    placements: resolveSessionPlacements(spec, opts.cardKey),
    origin: opts.origin,
    placement: null,
    inPlace,
  };
  installListeners({ attachMouseUp: opts.externalCommit !== true });
  // A drop session is a CONTENT layout gesture: publish the begin edge so
  // every geometry follower on the LayoutGestureBus parks for its duration
  // (O(1) settles per drag, not O(frames) re-measures). End edges fire at
  // commit entry (pointer released) and in `endDropSession` — idempotent.
  beginContentGesture(opts.cardKey);
  // CSS hooks: set crosshair cursor + mark active for both modes. Dim
  // the source float only on the popped-out gesture path — there's no
  // float to dim during a lifted-overlay (in-place) drag.
  if (typeof document !== "undefined") {
    document.body.setAttribute("data-drop-mode-active", "true");
    document.body.style.cursor = "crosshair";
    if (!inPlace) markSourceFloat(opts.cardKey, true);
  }
  emitSession();
  return true;
}

/** Hard-end the current session (used for both success and cancel). */
export function endDropSession() {
  if (!session) return;
  const key = session.cardKey;
  const inPlace = session.inPlace;
  session = null;
  // Idempotent (no-op if commit entry already ended it). Every cancel path
  // funnels here, so a session can never outlive its bus gesture — a wedged
  // content gesture would hold every parked geometry follower app-wide.
  endContentGesture();
  removeListeners();
  if (typeof document !== "undefined") {
    document.body.removeAttribute("data-drop-mode-active");
    document.body.style.cursor = "";
    if (!inPlace) markSourceFloat(key, false);
  }
  emitSession();
}

/** Public alias for cancellation paths (Escape, leave window, etc). */
export function cancelDropSession() {
  endDropSession();
}

// ── Window listeners ─────────────────────────────────────────────────

// The LIVE pointer point. The coalesced pass reads it at frame time rather
// than closing over the coordinate of the event that scheduled it, so a burst
// of events inside one frame resolves at the LAST position by construction.
let lastPointerX = 0;
let lastPointerY = 0;
/** Ask for a pass — never run one inline. Auto-scroll's frame writes
 *  `scrollTop` and then calls this, so the WRITE and the next READ land in
 *  different frames. */
const reHitTestAtPointer = () => {
  if (session) scheduleMovePass();
};
let onMove: ((e: MouseEvent) => void) | null = null;
let onUp: ((e: MouseEvent) => void) | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;
let onLeave: ((e: MouseEvent) => void) | null = null;
let onEnter: ((e: MouseEvent) => void) | null = null;

function installListeners(opts: { attachMouseUp: boolean }) {
  if (typeof window === "undefined") return;
  // Arm the gesture's ONE geometry door (paired with `disarmMoveGeometry` in
  // `removeListeners`, the single teardown every ending funnels through). The
  // container resolve is a closure rather than a value because a producer can
  // begin a session while its editor's view is still settling — the door
  // captures on first READ, not here.
  armMoveGeometry(() => {
    const dom = session?.ctx.mainEditor?.view?.dom as HTMLElement | undefined;
    return dom ? ((findEditorScrollFor(dom) as HTMLElement | null) ?? null) : null;
  });
  onMove = (e: MouseEvent) => {
    // Missed-release failsafe (the pane-engine invariant, task 185): every
    // producer is a hold-drag (mousedown → drag → mouseup), so a move with
    // the primary button no longer held means the release happened where we
    // never saw it (iframe, context menu, outside the window). End NOW —
    // with the session now published on the LayoutGestureBus, a wedged
    // gesture would hold every parked geometry follower app-wide, not just
    // leak an overlay.
    if (isMissedRelease(e)) {
      cancelDropSession();
      return;
    }
    // Everything below this line is arithmetic or a scheduling bail — the raw
    // pointer path measures NOTHING (task 351). `feedAutoScroll` tests the
    // edge zone against the gesture's snapshotted container band, and the
    // hit-test runs once per coalesced frame rather than inline here.
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    scheduleMovePass();
    // Edge-zone auto-scroll (wave 2 P4): the container comes from the ONE
    // gesture geometry door (captured on first read, dropped at teardown); the
    // loop scrolls and asks for a pass at the parked pointer as content slides
    // underneath, and listener teardown stops it.
    feedAutoScroll(readMoveGeometry().scroll, e.clientY, reHitTestAtPointer);
  };
  onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") cancelDropSession();
  };
  onLeave = (e: MouseEvent) => {
    // Only react to leaving the document, not crossing into a child.
    if (e.relatedTarget == null && e.target === document.documentElement) {
      updatePlacement(null);
    }
  };
  onEnter = () => {
    // No-op; next mousemove re-computes.
  };
  window.addEventListener("mousemove", onMove);
  if (opts.attachMouseUp) {
    onUp = () => {
      void commitDropSession();
    };
    window.addEventListener("mouseup", onUp);
  }
  window.addEventListener("keydown", onKey);
  document.documentElement.addEventListener("mouseleave", onLeave);
  document.documentElement.addEventListener("mouseenter", onEnter);
}

function removeListeners() {
  if (typeof window === "undefined") return;
  stopAutoScroll();
  cancelMovePass();
  // The ONE end path every session ending funnels through, so a snapshot can
  // never survive into the next gesture.
  disarmMoveGeometry();
  if (onMove) window.removeEventListener("mousemove", onMove);
  if (onUp) window.removeEventListener("mouseup", onUp);
  if (onKey) window.removeEventListener("keydown", onKey);
  if (onLeave) document.documentElement.removeEventListener("mouseleave", onLeave);
  if (onEnter) document.documentElement.removeEventListener("mouseenter", onEnter);
  onMove = onUp = onKey = onLeave = onEnter = null;
}

// ── Move / up handlers ───────────────────────────────────────────────

// ── The move pass: ONE per FRAME, never per event ────────────────────
//
// The hit-test is the gesture's only measuring work, so it runs exactly where
// a coalesced gesture's reads belong: in a scheduled frame, at the latest
// pointer position, after React has committed the previous frame's indicator.
// Before task 351 it was paced by a 16 ms wall-clock gate whose FAST branch
// ran the whole hit-test synchronously INSIDE the mousemove handler — so on a
// 240 Hz mouse roughly every fourth raw event forced a layout, interleaved
// with the indicator's own React style write. Read → write → read per frame,
// which is the shape task 330 took out of the float move.
//
// rAF is the primary clock with a setTimeout SAFETY NET behind it, because
// headless / inactive-tab environments throttle rAF (in some cases it never
// fires under synthetic events) and a dropped pass would strand the last
// pointer position. Whichever fires first runs; the other is cancelled. The
// net is deliberately longer than a 60 Hz frame so rAF wins in a live browser.
const MOVE_PASS_FALLBACK_MS = 20;
let movePassRaf = 0;
let movePassTimer: ReturnType<typeof setTimeout> | null = null;

function cancelMovePass() {
  if (movePassRaf && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(movePassRaf);
  }
  movePassRaf = 0;
  if (movePassTimer !== null) {
    clearTimeout(movePassTimer);
    movePassTimer = null;
  }
}

function runMovePass() {
  cancelMovePass();
  if (!session) return;
  const placement = hitTest(
    lastPointerX,
    lastPointerY,
    session.spec,
    session.placements,
    session.cardKey,
    session.ctx.mainEditor,
  );
  updatePlacement(placement);
}

function scheduleMovePass() {
  if (!session) return;
  if (movePassRaf || movePassTimer !== null) return; // already queued
  if (typeof requestAnimationFrame === "function") {
    movePassRaf = requestAnimationFrame(runMovePass);
  }
  movePassTimer = setTimeout(runMovePass, MOVE_PASS_FALLBACK_MS);
}

function updatePlacement(placement: Placement | null) {
  if (!session) return;
  if (placementsEqual(session.placement, placement)) return;
  session = { ...session, placement };
  if (typeof document !== "undefined") {
    // Crosshair signals "no valid drop here"; once a placement (the blue
    // insert bar) is showing, drop the crosshair so it can't obscure the bar.
    // `cursor` INHERITS, so a real change on `<body>` is a full-tree style
    // recalc — the same shape the drop-mode `user-select` rule was scoped to
    // the body element for (globals.css, measured 36 ms at 18.5k nodes). It is
    // a MODE edge, not a per-move one, so it is bailed here rather than left
    // to the CSSOM's own same-value check.
    const cursor = placement ? "none" : "crosshair";
    if (document.body.style.cursor !== cursor) {
      document.body.style.cursor = cursor;
    }
  }
  emitSession();
}

function placementsEqual(a: Placement | null, b: Placement | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.editor !== b.editor) return false;
  if (a.kind === "between-blocks" && b.kind === "between-blocks") {
    return a.insertPos === b.insertPos;
  }
  if (a.kind === "inline-cursor" && b.kind === "inline-cursor") {
    return a.pos === b.pos;
  }
  if (a.kind === "paragraph-side" && b.kind === "paragraph-side") {
    return a.paragraphId === b.paragraphId && a.side === b.side;
  }
  return false;
}

/**
 * Commit the current drop session at its current placement. Routes
 * through the spec's classifyDrop → apply / confirm / no-op decision
 * tree, ending the session in every case. Safe to call when no
 * session is active (no-op).
 *
 * Default callers leave commit to the controller's own mouseup
 * listener (`installListeners` attaches `onUp` that delegates here).
 * Callers that opt out via `externalCommit: true` invoke this
 * directly from their own gesture handler.
 */
export async function commitDropSession(): Promise<void> {
  if (!session) return;
  // The POINTER gesture is over the moment commit is entered — end the bus
  // gesture here, not after the async apply: a confirm dialog must not hold
  // every parked follower hostage while the user reads it, and the commit's
  // own structural burst (applyDrop → RO storm) then settles through the
  // normal live paths, one coalesced pass each. `endDropSession` repeats the
  // call harmlessly for the cancel legs below.
  endContentGesture();
  const s = session;
  // The ctx this gesture STARTED in — never a re-read of "the active pane",
  // which can have changed under a long drag (a background pane mounting, the
  // user tabbing away) and would apply the drop against a different document.
  const ctx = s.ctx;
  let placement = s.placement;
  if (!placement) {
    cancelDropSession();
    return;
  }
  // Mint-at-commit: the per-move hit-test never mints (the D4 drag cliff —
  // full doc walk + dispatch + synchronous .tex flush per pointermove). A
  // uuid-less target rode a pos-keyed sentinel; resolve it to a real minted
  // uuid NOW, through the same ensureAnchorUuid SSOT, exactly once per
  // gesture. A vanished block (sentinel no longer resolvable) is a no-op.
  if (
    placement.kind === "paragraph-side" &&
    isUnmintedParagraphId(placement.paragraphId)
  ) {
    const minted = mintPlacementUuid(placement.editor, placement.paragraphId);
    if (!minted) {
      cancelDropSession();
      return;
    }
    placement = { ...placement, paragraphId: minted };
  }
  const decision = s.spec.classifyDrop(placement, s.cardKey, ctx);
  if (decision.kind === "no-op") {
    cancelDropSession();
    return;
  }
  if (decision.kind === "confirm") {
    // Tear down listeners + cursor but keep the visual indicator on
    // while the modal is open — the user is looking at it.
    removeListeners();
    if (typeof document !== "undefined") {
      document.body.style.cursor = "";
    }
    const ok = await ctx.confirm({
      title: decision.title,
      message: decision.message,
      confirmLabel: decision.confirmLabel,
      cancelLabel: decision.cancelLabel,
    });
    if (ok) {
      finishApply(s.spec, placement, s.cardKey, ctx);
    } else {
      endDropSession();
    }
    return;
  }
  // decision.kind === "apply"
  finishApply(s.spec, placement, s.cardKey, ctx);
}

function finishApply(
  spec: DropSpec,
  placement: Placement,
  cardKey: string,
  ctx: DropCtx,
) {
  let applied = false;
  try {
    spec.applyDrop(placement, cardKey, ctx);
    applied = true;
  } catch (err) {
    // Don't leave the session hanging if applyDrop throws — log for the
    // dev and exit cleanly.
    console.error("[drop-mode] applyDrop threw:", err);
  }
  // CHIP-C: decouple `.tex` durability from whether a MINT happened. On a
  // successful paragraph re-anchor commit, persist the doc bundle NOW so the
  // target paragraph's `%!v:<uuid>` reaches the `.tex` on the card's fast
  // clock — even when the paragraph already carried a UUID and so dispatched
  // no mint tx (the RC3 gap). ONE flush per commit (this is the single mouseup
  // commit per gesture); the hit-test mint-flush during the drag coalesces with
  // it (the wired flush dedupes by content — see `useDocument.flushAnchorCommit`).
  // Only paragraph-side placements re-anchor a card to a paragraph; between-
  // blocks / inline-cursor drops (content moves, inline atoms) carry no
  // paragraphId and need no anchor flush. We already passed the `no-op` gate in
  // `commitDropSession`, so reaching here means `classifyDrop !== 'no-op'`.
  if (applied && placement.kind === "paragraph-side") {
    ctx.requestAnchorFlush?.(placement.paragraphId);
  }
  // `postDrop: "close"` dismisses the popped-out float, so it is gated on the
  // same report the flush above is (task 321). It used to run unconditionally:
  // an `applyDrop` that THREW logged to the console and still closed the float,
  // which is the harshest form of this bug class — the card the user was
  // dragging disappears on the one path where something actually went wrong.
  // (The silent half — a spec that refuses by returning — no longer reaches
  // here at all: a planned spec resolves its refusals in `planDrop`, so
  // `classifyDrop` reports `no-op` and `commitDropSession` cancels.)
  if (applied && spec.postDrop === "close") {
    ctx.closePopout(cardKey);
  }
  endDropSession();
}

// ── Source-float CSS toggle ──────────────────────────────────────────

function markSourceFloat(cardKey: string, active: boolean) {
  // Colon-safe id (the entity id = `data-pristine-card-id`), via the dual-read
  // parser — a float: key's id is everything after the 3rd colon.
  const id = parseAnyKey(cardKey)?.id;
  if (!id) return;
  // Look for the FloatingPanel containing this card and toggle the dimming
  // attr. The selector targets the pristine card wrapper inside FloatWindow;
  // from there, ascend to the floating panel root.
  const wrappers = document.querySelectorAll<HTMLElement>(
    `[data-pristine-card-id="${cssEscapeAttr(id)}"]`,
  );
  wrappers.forEach((w) => {
    const panel = w.closest<HTMLElement>('[data-floating-panel="true"]');
    if (!panel) return;
    if (active) panel.setAttribute("data-drop-mode-source", "true");
    else panel.removeAttribute("data-drop-mode-source");
  });
}

function cssEscapeAttr(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}
