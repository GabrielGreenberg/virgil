"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveBarOccupancy } from "./bar-occupancy";

/**
 * The Virgil bar's ONE width negotiation — the measured half of the occupancy
 * ladder in [bar-occupancy.ts](./bar-occupancy.ts). Read that file first: it
 * states the priority rule (protected status > tabs > collapsible tools), the
 * predicate, and why the predicate needs neither hysteresis nor a cached
 * "width in the other state".
 *
 * ── Cost ─────────────────────────────────────────────────────────────────
 * ONE `ResizeObserver` for the whole bar, observing three boxes: the tab
 * strip's own flex box, the tab row's `max-content` wrapper, and the tools
 * group's `max-content` wrapper. Per fire it reads `entry.contentRect.width`
 * (delivered post-layout — it forces NO layout), stores it behind a
 * per-role equality bail, and re-runs a pure arithmetic predicate whose output
 * is ONE boolean, committed only when it flips. So a continuous OS window
 * resize costs three number compares plus one comparison per frame, and
 * exactly ONE React render across the whole drag — at the crossing.
 *
 * It observes NOTHING that changes while typing (tab widths move on open /
 * close / rename, tool widths on a badge self-gating), so it is invisible to
 * keystroke sanctity: no editor subscription, no `emitCount`.
 *
 * ── Live during a layout gesture, deliberately ───────────────────────────
 * AGENTS.md ("Layout-gesture stability") says a geometry follower either PARKS
 * or SUPPRESSES for the duration of a gesture. This one does neither, for the
 * reason `useWindowChrome` doesn't: the frame ITSELF is the obligation. Park
 * the decision and the bar visibly overlaps for the whole of an OS window
 * drag, which is the defect. The exemption is affordable precisely because
 * the per-fire cost above is O(1) with a boolean equality bail — the thing
 * parking exists to bound is already bounded.
 *
 * ── The user always outranks the rule ────────────────────────────────────
 * `topbarRightCollapsed` (a persisted view pref) is the user's own choice and
 * is never written by the auto rule. Expanding out of an AUTO collapse sets a
 * session-scoped override instead, so the chip is never a dead control — the
 * same shape as "a pod the user has DRAGGED away from home keeps user
 * positioning". The override is dropped the moment the condition that created
 * it goes away, so it can't silently outlive a window resize.
 */
export type BarOccupancy = {
  /** The EFFECTIVE collapsed state of the tools group: user pref ∨ auto rule. */
  toolsCollapsed: boolean;
  /** True when the AUTO rule (not the user) is what collapsed the tools. */
  autoCollapsed: boolean;
  /** Toggle the tools group — the chip's click handler. */
  toggleTools: () => void;
  /** Ref callback for the tab strip's own flex box. */
  tabStripMeasureRef: (el: HTMLElement | null) => void;
  /** Ref callback for the tab row's `max-content` wrapper. */
  tabsMeasureRef: (el: HTMLElement | null) => void;
  /** Ref callback for the tools group's `max-content` wrapper. */
  toolsMeasureRef: (el: HTMLElement | null) => void;
};

type Role = "tabStrip" | "tabs" | "tools";

/** The three measured inline sizes, `null` until first measured. */
type Measured = Record<Role, number | null>;

export function useBarOccupancy(opts: {
  /** The user's persisted collapse pref. */
  userCollapsed: boolean;
  /** The persisted pref's setter — written ONLY by an explicit user toggle. */
  setUserCollapsed: (next: boolean) => void;
}): BarOccupancy {
  const { userCollapsed, setUserCollapsed } = opts;

  const [autoCollapsed, setAutoCollapsed] = useState(false);
  // Set when the user expands out of an AUTO collapse; dropped as soon as the
  // auto condition clears, so it never outlives the crowding that created it.
  const [expandOverride, setExpandOverride] = useState(false);

  const effective = userCollapsed || (autoCollapsed && !expandOverride);

  // Live measurements + the last committed verdict, both in refs so the
  // observer callback can bail without reading React state.
  const measuredRef = useRef<Measured>({ tabStrip: null, tabs: null, tools: null });
  const effectiveRef = useRef(effective);
  const autoRef = useRef(autoCollapsed);

  // LAYOUT effect, not a passive one, and not a write during render: a
  // `ResizeObserver` is delivered at the END of the browser's layout step for
  // the commit that just landed, which is BEFORE React flushes passive effects.
  // So a passive sync would hand the callback the PRE-collapse `effective`
  // together with the POST-collapse widths — exactly the mismatched pair the
  // state-independent predicate (bar-occupancy.ts) assumes cannot happen, and
  // the flip-flop it exists to prevent. A layout effect runs synchronously in
  // the commit phase, so the refs are current before any observation of the
  // layout that commit produced.
  useLayoutEffect(() => {
    effectiveRef.current = effective;
    autoRef.current = autoCollapsed;
  }, [effective, autoCollapsed]);

  const resolve = useCallback(() => {
    const m = measuredRef.current;
    const next = resolveBarOccupancy({
      tabStripPx: m.tabStrip,
      tabsNaturalPx: m.tabs,
      toolsNaturalPx: m.tools,
      toolsCollapsed: effectiveRef.current,
    });
    if (next.toolsCollapsed === autoRef.current) return; // equality bail
    autoRef.current = next.toolsCollapsed;
    setAutoCollapsed(next.toolsCollapsed);
    // The expand override exists only for the duration of the crowding it
    // answers, so it is dropped HERE — on the one edge where that crowding
    // clears — rather than from an effect watching for it. Same rule the
    // layout-gesture bus follows: publish on the edge, never poll the state.
    if (!next.toolsCollapsed) setExpandOverride(false);
  }, []);

  const rolesRef = useRef<Map<Element, Role>>(new Map());
  const roRef = useRef<ResizeObserver | null>(null);
  const elsRef = useRef<Partial<Record<Role, Element | null>>>({});

  const ensureObserver = useCallback(() => {
    if (roRef.current) return roRef.current;
    if (typeof ResizeObserver === "undefined") return null;
    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const role = rolesRef.current.get(entry.target);
        if (!role) continue;
        const w = entry.contentRect.width;
        if (measuredRef.current[role] !== w) {
          measuredRef.current[role] = w;
          changed = true;
        }
      }
      if (changed) resolve();
    });
    roRef.current = ro;
    return ro;
  }, [resolve]);

  const bindRole = useCallback(
    (role: Role, el: HTMLElement | null) => {
      const prev = elsRef.current[role];
      if (prev === el) return;
      if (prev) {
        rolesRef.current.delete(prev);
        roRef.current?.unobserve(prev);
      }
      elsRef.current[role] = el;
      if (el) {
        rolesRef.current.set(el, role);
        ensureObserver()?.observe(el);
      } else {
        // The occupant left the bar (zen mode drops the tab strip). Drop its
        // measurement so the rule fails OPEN rather than deciding from a stale
        // width for an element that is no longer in the layout.
        measuredRef.current[role] = null;
        resolve();
      }
    },
    [ensureObserver, resolve],
  );

  const tabStripMeasureRef = useCallback(
    (el: HTMLElement | null) => bindRole("tabStrip", el),
    [bindRole],
  );
  const tabsMeasureRef = useCallback(
    (el: HTMLElement | null) => bindRole("tabs", el),
    [bindRole],
  );
  const toolsMeasureRef = useCallback(
    (el: HTMLElement | null) => bindRole("tools", el),
    [bindRole],
  );

  useEffect(() => {
    const ro = roRef.current;
    const roles = rolesRef.current;
    const els = elsRef.current;
    return () => {
      ro?.disconnect();
      roRef.current = null;
      roles.clear();
      for (const k of Object.keys(els) as Role[]) els[k] = null;
    };
  }, []);

  const toggleTools = useCallback(() => {
    if (effectiveRef.current) {
      // Expanding. Clear the persisted pref, and out-rank the auto rule ONLY
      // where the auto rule is what is currently collapsing — `autoRef`, not a
      // bare `true`. An override minted while nothing was crowding has nothing
      // to expire: the drop below fires on the auto TRUE→FALSE edge, which
      // never comes if the verdict was already false, so a wide-window
      // collapse-then-expand (an ordinary use of the chip) would leave a
      // sticky override that silently disables auto-collapse for the rest of
      // the session — the tab row clipping instead of the tools yielding, the
      // exact inverse of the priority this hook exists to enforce.
      setUserCollapsed(false);
      setExpandOverride(autoRef.current);
    } else {
      setUserCollapsed(true);
      setExpandOverride(false);
    }
  }, [setUserCollapsed]);

  return {
    toolsCollapsed: effective,
    autoCollapsed,
    toggleTools,
    tabStripMeasureRef,
    tabsMeasureRef,
    toolsMeasureRef,
  };
}
