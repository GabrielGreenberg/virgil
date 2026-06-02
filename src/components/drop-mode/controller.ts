/**
 * Drop-mode controller. Module-level state + window listeners that own
 * the gesture from "shift-mousedown on FloatingPanel header" to drop or
 * cancel. Follows the `card-lift.ts` pattern: producer (FloatingPanel)
 * and consumers (Indicator, DropModeProvider) communicate via a shared
 * signal instead of React context, since they live in unrelated subtrees.
 *
 * Public API:
 *   - `setDropCtx(ctx)` — called once by EditorPane to register the
 *     per-doc hook bag.
 *   - `lookupSpec(kind)` — registry-aware spec lookup.
 *   - `beginDropSession({...})` — called from FloatingPanel header on
 *     shift-mousedown. Installs window listeners and a CSS hook.
 *   - `useDropSession()` — React hook for components that need to react
 *     to the current placement (Indicator).
 *
 * Cancellation is idempotent and routes through `endDropSession()`.
 */

import { useEffect, useState } from "react";
import type { DropCtx, DropSession, DropSpec, Placement } from "./types";
import { hitTest } from "./hit-test";
import { lookupSpec } from "./registry";

// ── Per-doc context ──────────────────────────────────────────────────

let activeCtx: DropCtx | null = null;
export function setDropCtx(ctx: DropCtx | null) {
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
 * Begin a drop session from the FloatingPanel header. Looks up the
 * spec from `cardKey`; no-ops if no spec is registered (Phase 0 ships
 * with no specs, so shift-grab is harmless until paragraphDropSpec
 * lands).
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
  const sep = opts.cardKey.indexOf(":");
  if (sep <= 0) return false;
  const kind = opts.cardKey.slice(0, sep);
  // `lookupSpec` takes the FULL cardKey: most kinds dispatch on the prefix,
  // but `textobject:linkedRange:<id>` routes to the text-range-move spec
  // (a plain selection moves as a slice, not a block) — L3f-2.
  const spec = lookupSpec(opts.cardKey);
  if (!spec) return false;

  const inPlace = opts.inPlace === true;
  session = {
    cardKey: opts.cardKey,
    kind,
    spec,
    origin: opts.origin,
    placement: null,
    inPlace,
  };
  installListeners({ attachMouseUp: opts.externalCommit !== true });
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
let onMove: ((e: MouseEvent) => void) | null = null;
let onUp: ((e: MouseEvent) => void) | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;
let onLeave: ((e: MouseEvent) => void) | null = null;
let onEnter: ((e: MouseEvent) => void) | null = null;

function installListeners(opts: { attachMouseUp: boolean }) {
  if (typeof window === "undefined") return;
  onMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
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
  const s = session;
  const ctx = activeCtx;
  const placement = s.placement;
  if (!placement) {
    cancelDropSession();
    return;
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
  try {
    spec.applyDrop(placement, cardKey, ctx);
  } catch (err) {
    // Don't leave the session hanging if applyDrop throws — log for the
    // dev and exit cleanly.
    console.error("[drop-mode] applyDrop threw:", err);
  }
  if (spec.postDrop === "close") {
    ctx.closePopout(cardKey);
  }
  endDropSession();
}

// ── Source-float CSS toggle ──────────────────────────────────────────

function markSourceFloat(cardKey: string, active: boolean) {
  const sep = cardKey.indexOf(":");
  if (sep <= 0) return;
  const id = cardKey.slice(sep + 1);
  // Look for the FloatingPanel containing this card and toggle the
  // dimming attr. The selector targets the pristine card wrapper inside
  // FloatCard; from there, ascend to the floating panel root.
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
