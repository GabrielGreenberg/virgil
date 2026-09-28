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
 *   - collapsed footnote / archive → T1 (nearness is irrelevant — the whole
 *     class of per-collapsed-card live editors goes) WHEN the static render
 *     is faithful. That is a declared, tested property of the body, not of
 *     the kind (task 823): an archived excerpt can hold an expex example, a
 *     figure or a `%` comment, whose look comes from a NodeView with no
 *     static twin. The caller passes `staticSafe: false` for such a body
 *     (`bodyNeedsLiveRender`, borrowed-render.ts) and it is promoted to T2;
 *     under a ceiling below T2 it shows the T0 summary rather than an
 *     unfaithful T1.
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
 * `localStorage.setItem("virgil:card-tiers","on")` + reload (`"1"`/`"true"`/
 * `"yes"` work too — the dialect is universal, per `src/lib/feature-flags.ts`).
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
import { readFlag } from "@/lib/feature-flags";
import {
  readCardNearness,
  subscribeCardNearness,
} from "./card-near-zone";

export type CardTier = 0 | 1 | 2 | 3;

/** Kill-switch/soak flag — default OFF. Read per call (two dictionary hits),
 *  so flipping it needs only a reload, not a rebuild. */
export function cardTiersEnabled(): boolean {
  return readFlag("virgil:card-tiers");
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
  /** False when the body holds a node the static tier cannot paint
   *  faithfully (task 823) — T1 is then never the answer. */
  staticSafe = true,
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
  return resolveCollapsedTier(policy, near, ceiling, staticSafe);
}

/**
 * The pure tier decision behind {@link useCardTier}: the policy's tier, capped
 * by the ceiling — with T1 replaced for a body that is not static-safe
 * (promoted to T2 where the ceiling allows, else down to the T0 summary).
 */
export function resolveCollapsedTier(
  policy: CollapsedTierPolicy,
  near: boolean,
  ceiling: CardTier,
  staticSafe: boolean,
): CardTier {
  let policyTier: CardTier = policy === "static" ? 1 : near ? 2 : 1;
  if (!staticSafe && policyTier === 1) policyTier = 2;
  const capped = (policyTier < ceiling ? policyTier : ceiling) as CardTier;
  return !staticSafe && capped === 1 ? 0 : capped;
}
