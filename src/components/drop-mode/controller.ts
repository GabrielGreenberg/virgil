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
 *   - `setDropCtx(ctx)` — called once by EditorPane to register the
 *     per-doc hook bag.
 *   - `lookupSpec(kind)` — registry-aware spec lookup.
 *   - `beginDropSession({...})` — called from a producer's mousedown.
 *     Installs window listeners and a CSS hook.
 *   - `useDropSession()` — React hook for components that need to react
 *     to the current placement (Indicator).
 *
 * Cancellation is idempotent and routes through `endDropSession()`.
 */

import { useEffect, useState } from "react";
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
import { findEditorScrollFor } from "@/components/editor-layout/layout-scroll";

// ── Per-doc context ──────────────────────────────────────────────────

let activeCtx: DropCtx | null = null;
export function setDropCtx(ctx: DropCtx | null) {
  // If the editor unmounts mid-drag (route change, or a card-body float
  // closing mid-gesture), end any live session first. InlineAtomGrab starts
  // sessions with `externalCommit`, so the controller has no mouseup of its
  // own to fall back on — without this the body CSS hooks
  // (`data-drop-mode-active`, the crosshair cursor, and the global
  // `user-select:none` keyed on that attr) would stay stuck with nothing left
  // to clear them, turning the whole document unselectable.
  if (ctx === null && session) cancelDropSession();
  activeCtx = ctx;
}
export function getDropCtx(): DropCtx | null {
  return activeCtx;
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
 * Returns true if a session was started, false if rejected (no spec,
 * another session active, or no DropCtx registered).
 */
export function beginDropSession(opts: {
  cardKey: string;
  origin: { x: number; y: number };
  inPlace?: boolean;
  externalCommit?: boolean;
}): boolean {
  if (session) return false; // first gesture wins
  if (!activeCtx) return false;
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

let lastMoveTs = 0;
let pendingMove: { x: number; y: number; t: ReturnType<typeof setTimeout> } | null = null;
// Auto-scroll support: the last pointer point (so the loop can re-hit-test
// while the pointer parks in the edge zone) and the session's scroll
// container (undefined = not yet resolved this session; null = none).
let lastPointerX = 0;
let lastPointerY = 0;
let sessionScrollEl: HTMLElement | null | undefined;
const reHitTestAtPointer = () => {
  if (session) handleMove(lastPointerX, lastPointerY);
};
let onMove: ((e: MouseEvent) => void) | null = null;
let onUp: ((e: MouseEvent) => void) | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;
let onLeave: ((e: MouseEvent) => void) | null = null;
let onEnter: ((e: MouseEvent) => void) | null = null;

function installListeners(opts: { attachMouseUp: boolean }) {
  if (typeof window === "undefined") return;
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
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    handleMove(e.clientX, e.clientY);
    // Edge-zone auto-scroll (wave 2 P4): scroll container resolved lazily
    // once per session; the loop re-runs the throttled hit-test at the
    // parked pointer as content slides underneath, and listener teardown
    // stops it.
    if (sessionScrollEl === undefined) {
      const dom = activeCtx?.mainEditor?.view?.dom as HTMLElement | undefined;
      sessionScrollEl = (dom ? findEditorScrollFor(dom) : null) as
        | HTMLElement
        | null;
    }
    feedAutoScroll(sessionScrollEl, e.clientY, reHitTestAtPointer);
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
  sessionScrollEl = undefined;
  if (onMove) window.removeEventListener("mousemove", onMove);
  if (onUp) window.removeEventListener("mouseup", onUp);
  if (onKey) window.removeEventListener("keydown", onKey);
  if (onLeave) document.documentElement.removeEventListener("mouseleave", onLeave);
  if (onEnter) document.documentElement.removeEventListener("mouseenter", onEnter);
  onMove = onUp = onKey = onLeave = onEnter = null;
  if (pendingMove) {
    clearTimeout(pendingMove.t);
    pendingMove = null;
  }
}

// ── Move / up handlers ───────────────────────────────────────────────

/**
 * Throttle hit-test to ~one run per 16ms. Uses setTimeout-based pacing
 * rather than `requestAnimationFrame` because headless / inactive-tab
 * environments throttle rAF aggressively (in some cases it never fires
 * during synthetic-event tests).
 */
function handleMove(x: number, y: number) {
  if (!session || !activeCtx) return;
  const now = Date.now();
  const minGap = 16;
  const sinceLast = now - lastMoveTs;
  const run = () => {
    pendingMove = null;
    lastMoveTs = Date.now();
    if (!session || !activeCtx) return;
    const placement = hitTest(
      x,
      y,
      session.spec,
      session.placements,
      session.cardKey,
      activeCtx.mainEditor,
    );
    updatePlacement(placement);
  };
  if (sinceLast >= minGap) {
    if (pendingMove) {
      clearTimeout(pendingMove.t);
      pendingMove = null;
    }
    run();
  } else {
    if (pendingMove) clearTimeout(pendingMove.t);
    pendingMove = { x, y, t: setTimeout(run, minGap - sinceLast) };
  }
}

function updatePlacement(placement: Placement | null) {
  if (!session) return;
  if (placementsEqual(session.placement, placement)) return;
  session = { ...session, placement };
  if (typeof document !== "undefined") {
    // Crosshair signals "no valid drop here"; once a placement (the blue
    // insert bar) is showing, drop the crosshair so it can't obscure the bar.
    document.body.style.cursor = placement ? "none" : "crosshair";
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
  if (!session || !activeCtx) return;
  // The POINTER gesture is over the moment commit is entered — end the bus
  // gesture here, not after the async apply: a confirm dialog must not hold
  // every parked follower hostage while the user reads it, and the commit's
  // own structural burst (applyDrop → RO storm) then settles through the
  // normal live paths, one coalesced pass each. `endDropSession` repeats the
  // call harmlessly for the cancel legs below.
  endContentGesture();
  const s = session;
  const ctx = activeCtx;
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
