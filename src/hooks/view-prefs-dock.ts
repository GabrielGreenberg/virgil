/**
 * The dock-stack engine — the ONE place panel open/close/place/remove is
 * decided. Pure functions over a `ViewPrefs` snapshot; no React, no
 * persistence, no side effects.
 *
 * This is the WRITE twin of the read-only `view-prefs-derived` leaf, and it
 * follows the same import discipline: it imports only TYPES from
 * `useViewPrefs` (plus the tiny `spawn-position` geometry helper), so
 * `useViewPrefs.ts` can value-import it with no runtime cycle. `MAX_STACK` /
 * `MIN_BAND_PX` live here and are re-exported from `useViewPrefs` for the
 * components that already import them from there.
 *
 * WHY IT EXISTS (task 273). `dockOpen` was extracted as *the* shared
 * docked-open helper — sentinel clear, cap + LRU eviction, MRU bump — and the
 * consolidation then stalled: `redockPanel` re-implemented insertion inline
 * (and, until task 272, silently omitted the sentinel clear, so redocking onto
 * a collapsed side rendered nothing); five setters each re-derived the close
 * branch; three re-derived the mode-dispatch/float-open branch; and
 * `clampStack` carried its own `max = 3` literal beside `MAX_STACK`. A helper
 * that only *some* of the sibling paths call is not an SSOT — the invariants it
 * encodes drift out of every path that re-derives them, one silent omission at
 * a time.
 *
 * So the rule this module exists to keep:
 *
 * > **Every insertion into (and removal from) a dock stack goes through
 * > `placeInStack` / `removeFromStack`.** A setter in `useViewPrefs` never
 * > spells `dockStack:` / `panelMRU:` / `poppedOutPanels:` itself — CI: the
 * > hook-body census in `view-prefs-dock-engine.test.ts`.
 *
 * The three invariants an inline copy is apt to drop, and which every entry
 * point here therefore owns:
 *
 *  1. **Sentinel clear.** A docked band's `[data-dock-slot]` portal target only
 *     exists in an expanded, non-blank column, so placing a panel on a side
 *     must un-collapse AND un-blank it or the panel renders nothing.
 *  2. **Cap + eviction.** `MAX_STACK` bands per side; over the cap (or with no
 *     room to breathe, when the caller measured one) the least-recently-used
 *     band closes — victim SELECTION stays in the shared `leastRecentlyUsed`,
 *     which both paths already used correctly (task 251).
 *  3. **MRU coupling.** A panel that leaves a stack leaves the recency list
 *     (`pruneMRU`), and one that arrives is bumped to the front. A missed copy
 *     here is a silent recency corruptor: the eviction victim goes wrong once,
 *     much later, for a user who never touched the panel that vanished.
 */
import { computeColumnSpawnRect } from "@/components/editor-layout/spawn-position";
import { dockedSideOf } from "./view-prefs-derived";
import type { PanelId, PanelMode, Side, ViewPrefs } from "@/hooks/useViewPrefs";

/** Max docked panels stacked on one side (the stack ceiling). */
export const MAX_STACK = 3;
/** Minimum free vertical space (px) a newly-opened panel needs before it
 *  will displace the least-recently-used band instead of fitting in the
 *  current omni gap. */
export const MIN_BAND_PX = 140;

/** A float's saved rect. */
export interface FloatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ── Stack / MRU accessors ────────────────────────────────────────────── */

export function stackFor(p: ViewPrefs, side: Side): PanelId[] {
  return side === "left" ? p.dockStack.left : p.dockStack.right;
}

export function withStack(p: ViewPrefs, side: Side, next: PanelId[]): ViewPrefs {
  return side === "left"
    ? { ...p, dockStack: { ...p.dockStack, left: next } }
    : { ...p, dockStack: { ...p.dockStack, right: next } };
}

export function mruFor(p: ViewPrefs, side: Side): PanelId[] {
  return side === "left" ? p.panelMRU.left : p.panelMRU.right;
}

export function withMRU(p: ViewPrefs, side: Side, next: PanelId[]): ViewPrefs {
  return side === "left"
    ? { ...p, panelMRU: { ...p.panelMRU, left: next } }
    : { ...p, panelMRU: { ...p.panelMRU, right: next } };
}

/** True when `id` is open in any form (docked in a stack or floating). */
export function isPanelOpen(p: ViewPrefs, id: PanelId): boolean {
  return p.poppedOutPanels.includes(id) || dockedSideOf(p, id) !== null;
}

/** Bump `id` to the front (most-recent) of its side's MRU. No-op (same
 *  object reference) when already at the front. */
export function bumpMRU(p: ViewPrefs, side: Side, id: PanelId): ViewPrefs {
  const cur = mruFor(p, side);
  if (cur[0] === id) return p;
  return withMRU(p, side, [id, ...cur.filter((x) => x !== id)]);
}

/** Drop `id` from both sides' MRU lists. */
export function pruneMRU(p: ViewPrefs, id: PanelId): ViewPrefs {
  return {
    ...p,
    panelMRU: {
      left: p.panelMRU.left.filter((x) => x !== id),
      right: p.panelMRU.right.filter((x) => x !== id),
    },
  };
}

/** The stalest docked panel on `side` — the eviction victim.
 *
 *  Recency (`panelMRU`) is SESSION-ONLY: `loadPrefs` restores the full
 *  `dockStack` on reload but resets the MRU to empty, so a docked panel
 *  the user hasn't touched THIS session is absent from the MRU entirely —
 *  and is, by definition, staler than any tracked panel. So an untracked
 *  band always outranks a tracked one as the victim; among untracked
 *  bands the oldest-opened (lowest stack index, since opens append at the
 *  bottom) goes first. Only when EVERY docked panel is tracked does true
 *  MRU recency decide — the least-recently-used tracked panel (MRU
 *  tail→head). The zero-coverage case (empty MRU, e.g. just after a
 *  reload) falls out of the untracked rule as `stack[0]`. */
export function leastRecentlyUsed(p: ViewPrefs, side: Side): PanelId | null {
  const stack = stackFor(p, side);
  if (stack.length === 0) return null;
  const mru = mruFor(p, side);
  // An untracked (never-used-this-session) band is stalest — evict the
  // oldest-opened such (lowest stack index) before any tracked panel.
  const untracked = stack.find((id) => !mru.includes(id));
  if (untracked !== undefined) return untracked;
  // Full coverage: the least-recently-used tracked panel (MRU tail→head).
  for (let i = mru.length - 1; i >= 0; i--) {
    if (stack.includes(mru[i])) return mru[i];
  }
  return stack[0];
}

/* ── The two insertion/removal SSOTs ──────────────────────────────────── */

export interface PlaceInStackOptions {
  /** Slot to splice at (clamped to the stack); omitted ⇒ append at the
   *  BOTTOM. An explicit index is a user-chosen drop slot (redock). */
  index?: number;
  /** The caller's one-shot measurement of the side's free omni space, in
   *  px. Supplied ⇒ a newcomer that can't get `MIN_BAND_PX` of breathing
   *  room displaces the least-recently-used band instead of squeezing in.
   *  OMITTED ⇒ assume it fits, and evict only at the hard `MAX_STACK` cap.
   *
   *  Deliberately optional rather than defaulted-to-a-number: a drag-drop
   *  redock has no free-space measurement to give, and refusing an explicit
   *  user drop for breathing room — or silently evicting a *different* band
   *  to honor it — is worse than a tight fit (task 273 design fork 1). */
  freeSpacePx?: number;
}

/**
 * THE insertion SSOT: make `id` a docked band on `side`, at `index` (default
 * append at the bottom), removing every other trace of it first.
 *
 * Owns all three invariants above — sentinel clear, cap + LRU eviction, MRU —
 * plus: `panelModes[id] = "docked"` (so the next plain open comes back docked),
 * any prior FLOAT of `id` dropped, and any prior DOCK position of `id` dropped
 * (from either side) with its stale recency pruned. Post-condition: `id` is
 * docked exactly once, on `side`, and appears at the front of exactly that
 * side's MRU.
 *
 * Because `id` is removed from the target stack before the victim is chosen,
 * `leastRecentlyUsed` can never nominate `id` itself.
 */
export function placeInStack(
  p: ViewPrefs,
  id: PanelId,
  side: Side,
  opts: PlaceInStackOptions = {},
): ViewPrefs {
  const { index, freeSpacePx } = opts;
  let next: ViewPrefs = {
    ...p,
    panelModes: { ...p.panelModes, [id]: "docked" as PanelMode },
    // Invariant 1 — a docked band's portal target only exists in an
    // expanded, non-blank column.
    collapsedLeft: side === "left" ? false : p.collapsedLeft,
    collapsedRight: side === "right" ? false : p.collapsedRight,
    blankLeft: side === "left" ? false : p.blankLeft,
    blankRight: side === "right" ? false : p.blankRight,
    poppedOutPanels: p.poppedOutPanels.filter((x) => x !== id),
  };
  // Relocation (redock from the other side, movePanel, a re-place at a new
  // slot): shed the old position and its recency so the bump below leaves
  // `id` on exactly one side's MRU.
  const priorSide = dockedSideOf(next, id);
  if (priorSide) {
    next = withStack(next, priorSide, stackFor(next, priorSide).filter((x) => x !== id));
  }
  next = pruneMRU(next, id);

  // Invariant 2 — cap, plus the fit check when the caller measured.
  let stack = stackFor(next, side);
  const fits = freeSpacePx == null ? true : freeSpacePx >= MIN_BAND_PX;
  if (stack.length >= MAX_STACK || !fits) {
    const victim = leastRecentlyUsed(next, side);
    if (victim) {
      stack = stack.filter((x) => x !== victim);
      next = pruneMRU(next, victim);
    }
  }
  const at = index == null ? stack.length : Math.max(0, Math.min(index, stack.length));
  next = withStack(next, side, [...stack.slice(0, at), id, ...stack.slice(at)]);
  // Invariant 3.
  return bumpMRU(next, side, id);
}

/**
 * THE dock-removal SSOT: drop `id` from whichever side's stack holds it and
 * from both recency lists. Leaves any FLOAT of `id` alone — that is the
 * difference between undocking (which floats the panel) and closing it.
 */
export function removeFromStack(p: ViewPrefs, id: PanelId): ViewPrefs {
  const side = dockedSideOf(p, id);
  const next = side
    ? withStack(p, side, stackFor(p, side).filter((x) => x !== id))
    : p;
  return pruneMRU(next, id);
}

/** Close `id` in BOTH worlds — its dock band and its float. The saved float
 *  rect (`floatPositions`) and mode preference (`panelModes`) are deliberately
 *  kept, so re-opening restores the user's pinned size and mode. */
export function closePanel(p: ViewPrefs, id: PanelId): ViewPrefs {
  const next = removeFromStack(p, id);
  return { ...next, poppedOutPanels: next.poppedOutPanels.filter((x) => x !== id) };
}

/** Close every panel — both stacks, both recency lists, every panel float.
 *  Card floats (`poppedOutCards`) are a different axis and are left to the
 *  caller. Collapse/blank sentinels are left alone: the side columns fall back
 *  to the omni background rather than folding away. */
export function closeAllPanels(p: ViewPrefs): ViewPrefs {
  return {
    ...p,
    dockStack: { left: [], right: [] },
    panelMRU: { left: [], right: [] },
    poppedOutPanels: [],
    poppedOutOrigins: {},
  };
}

/* ── Float side ───────────────────────────────────────────────────────── */

/** Open `id` as a float at its saved rect, or a fresh column-spawn rect on
 *  `side` when it has none. Idempotent on `poppedOutPanels`. */
export function floatOpen(p: ViewPrefs, id: PanelId, side: Side): ViewPrefs {
  const rect = p.floatPositions[id] ?? computeColumnSpawnRect(side);
  return {
    ...p,
    poppedOutPanels: p.poppedOutPanels.includes(id)
      ? p.poppedOutPanels
      : [...p.poppedOutPanels, id],
    floatPositions: { ...p.floatPositions, [id]: rect },
  };
}

/** Flip `id` from docked → floating at `rect`: shed the dock band + recency,
 *  seed the float rect, and record the mode so future opens float. */
export function undockToFloat(p: ViewPrefs, id: PanelId, rect: FloatRect): ViewPrefs {
  const next = removeFromStack(p, id);
  return {
    ...next,
    poppedOutPanels: next.poppedOutPanels.includes(id)
      ? next.poppedOutPanels
      : [...next.poppedOutPanels, id],
    panelModes: { ...next.panelModes, [id]: "floating" as PanelMode },
    floatPositions: { ...next.floatPositions, [id]: rect },
  };
}

/* ── Mode dispatch ────────────────────────────────────────────────────── */

/**
 * Open `id` in its PREFERRED mode — docked unless the user has undocked it
 * before (`panelModes`). The one open branch behind `openPanel`,
 * `togglePanel` and `togglePopout`, which each used to re-derive it.
 */
export function openInMode(
  p: ViewPrefs,
  id: PanelId,
  side: Side,
  freeSpacePx?: number,
): ViewPrefs {
  const mode: PanelMode = p.panelModes[id] ?? "docked";
  return mode === "docked"
    ? placeInStack(p, id, side, { freeSpacePx })
    : floatOpen(p, id, side);
}
