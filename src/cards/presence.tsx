"use client";

/**
 * Card presence tiers (perf Wave 3) — how much machinery a card BODY mounts.
 *
 * Tier model (per card body; header/chrome always render):
 *   T0 — summary string (the `makeCompressedSummary` projection)
 *   T1 — static HTML (`StaticBorrowedText` / a static example line)
 *   T2 — read-only live editor (today's BorrowedMainText / ExampleCardEditor
 *        readOnly path)
 *   T3 — editable (today's expand boundary, unchanged)
 *
 * Tiers gate ONLY collapsed bodies — the two switch sites are EditableCard's
 * compressed borrowed branch and ExampleCard's collapsed branch. An expanded
 * card's editable body is never tier-gated; expand always works.
 *
 * Policy (per kind, applied at the switch sites through `useCardTier`):
 *   - collapsed footnote / archive → T1 always (their collapsed body is
 *     prose; a static render is visually identical, so nearness is
 *     irrelevant — the whole class of per-collapsed-card live editors goes).
 *   - collapsed example → T2 near the viewport (the expex projection needs
 *     the real NodeViews), T1 far (a static number + first line).
 *   - hidden keep-alive panes → ceiling T1 (a hidden pane's collapsed
 *     bodies need no editors; re-show promotes near ones back — aligned
 *     with instant-switch: static HTML paints immediately, live editors
 *     resume via the near-zone at leisure).
 *
 * Load ramp: at doc-open the ceiling starts at T0 (first commit renders
 * headers + summaries), then steps to T1 and then to "no ceiling" via
 * self-chained `requestLowPriority` — so the initial commit never
 * materializes hundreds of static bodies, let alone editors. (The plan
 * sketched ~50-card chunks; global stages avoid per-card bookkeeping and
 * the T1 step is cheap static HTML.)
 *
 * Flag: `virgil:card-tiers`, DEFAULT OFF until soak. Off means every switch
 * site takes its legacy branch (tier 3 unconditionally) — zero new code on
 * the legacy path. Flip with
 * `localStorage.setItem("virgil:card-tiers","on")` + reload.
 *
 * Keystroke sanctity: the provider subscribes to nothing on the editor; the
 * per-card hook subscribes to the shared-IO near-zone store only where the
 * policy consults nearness (examples), via useSyncExternalStore.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { useIsVisible } from "@/lib/keep-alive/visibility-context";
import { requestLowPriority } from "@/lib/keep-alive/schedule-low-priority";
import {
  readCardNearness,
  subscribeCardNearness,
} from "./card-near-zone";

export type CardTier = 0 | 1 | 2 | 3;

/** Kill-switch/soak flag — default OFF. Read per call (two dictionary hits),
 *  so flipping it needs only a reload, not a rebuild. */
export function cardTiersEnabled(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("virgil:card-tiers") === "on"
    );
  } catch {
    return false;
  }
}

/** Ceiling context. Default 3 (no ceiling) so unwrapped consumers — tests,
 *  bare mounts — behave exactly as today (the KeepAliveVisibility
 *  default-true precedent). */
const CardPresenceContext = createContext<CardTier>(3);

export interface CardPresenceProviderProps {
  /** The pane's doc-open latch (EditorPane's `ready`): editor mounted AND
   *  doc content loaded. The ramp starts when it flips true. */
  ready: boolean;
  children: ReactNode;
}

/**
 * Mounts once per EditorPane, above every card surface (floats + both
 * docked rails — React context flows through portals by tree position).
 */
export function CardPresenceProvider({
  ready,
  children,
}: CardPresenceProviderProps) {
  const isVisible = useIsVisible();
  // Ramp stage: 0 (T0 ceiling) → 1 (T1 ceiling) → 3 (no ceiling). With the
  // flag off the ramp is inert (stage stays 3 — no ceiling, legacy paths).
  const [ramp, setRamp] = useState<CardTier>(() => (cardTiersEnabled() ? 0 : 3));

  useEffect(() => {
    if (!cardTiersEnabled()) return;
    if (!ready) return;
    // Self-chained low-priority steps (the pipeline.ts cancel-holder idiom):
    // each stage advances on idle, so the curtain-lift commit renders
    // summaries, the next idle renders static bodies, and only then does the
    // full policy (near examples going live) apply.
    let cancel: (() => void) | null = null;
    cancel = requestLowPriority(() => {
      setRamp(1);
      cancel = requestLowPriority(() => {
        cancel = null;
        setRamp(3);
      });
    });
    return () => {
      cancel?.();
    };
  }, [ready]);

  // Hidden keep-alive pane: cap at T1 (static) — but never RAISE the ramp
  // (a hide during stage 0 stays at 0). Recomputed per render; both inputs
  // change rarely (visibility flips, ramp steps).
  const ceiling: CardTier = isVisible ? ramp : (Math.min(ramp, 1) as CardTier);

  return (
    <CardPresenceContext.Provider value={ceiling}>
      {children}
    </CardPresenceContext.Provider>
  );
}

/** The provider's current ceiling (3 = unlimited / legacy). */
export function useCardPresenceCeiling(): CardTier {
  return useContext(CardPresenceContext);
}

export type CollapsedTierPolicy =
  | "static" // collapsed footnote/archive: T1 regardless of nearness
  | "near-live"; // collapsed example: T2 near, T1 far

/**
 * The tier a COLLAPSED card body should mount right now. Returns 3 whenever
 * the flag is off — the switch sites read `tier >= 2` as "take the legacy
 * live branch", so flag-off is byte-identical behavior.
 *
 * `cardEl` is the card's root element ref (PanelCard ref); only consulted —
 * and only observed — under the "near-live" policy with the flag on.
 */
export function useCardTier(
  policy: CollapsedTierPolicy,
  cardEl: RefObject<HTMLElement | null>,
): CardTier {
  const enabled = cardTiersEnabled();
  const ceiling = useCardPresenceCeiling();

  // Near-zone subscription — only meaningful for "near-live" with the flag
  // on; other configurations subscribe to nothing (the subscribe fn ignores
  // its callback and the snapshot is constant). Memoized on the stable ref
  // object so useSyncExternalStore subscribes ONCE per card, not per render;
  // the subscribe runs in a post-commit effect, by which point the PanelCard
  // ref has attached.
  const wantsNearness = enabled && policy === "near-live";
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!wantsNearness) return () => {};
      const el = cardEl.current;
      if (!el) return () => {};
      return subscribeCardNearness(el, cb);
    },
    [wantsNearness, cardEl],
  );
  const near = useSyncExternalStore(
    subscribe,
    () => (wantsNearness ? readCardNearness(cardEl.current) : true),
    () => false,
  );

  if (!enabled) return 3;
  const policyTier: CardTier = policy === "static" ? 1 : near ? 2 : 1;
  return (policyTier < ceiling ? policyTier : ceiling) as CardTier;
}
