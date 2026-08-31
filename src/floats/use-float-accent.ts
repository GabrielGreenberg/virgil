"use client";

import { useThemeVersion } from "@/hooks/usePanelTheme";
import {
  getPanelColor,
  themeFromAccent,
  type PanelThemeKey,
} from "@/lib/panel-theme";

/** The two accent values a float's chrome paints: the header-strip background
 *  (`FloatChrome`) and the raw kind accent the window ring resolves
 *  (`FloatingPanel` stamps it as `--link-anchor-color`). Both `undefined` for a
 *  float that declares no theme key — the neutral strip / neutral ring. */
export interface FloatAccent {
  headerTint?: string;
  accentTint?: string;
}

const NEUTRAL: FloatAccent = {};

/**
 * Resolve a float's accent LIVE (task 493).
 *
 * The law this codebase states everywhere else — *a value that is a live
 * function of app state is resolved at READ time from one authority, and every
 * renderer of it SUBSCRIBES* — applied to the fifth renderer of a kind's accent.
 * A card kind's accent is painted by the docked card (`useCardTheme`), the
 * margin marker, the in-text anchor, the highlight band, and a popped-out card
 * float. The first four subscribe to the panel-colour store; the float did not:
 * `cardFloatable` baked `headerTint` / `accentTint` into the `Floatable` value
 * object at RESOLVE time with a live but unsubscribed read, so picking a new
 * colour re-tinted the docked card, the marker, the anchor and the band while
 * the open float kept the old header strip and the old window ring — two
 * colours for one card in one window, healed only by an unrelated re-render.
 *
 * The deep half is that the colour left the `Floatable` entirely: a `Floatable`
 * is a *description of what to render*, and a value that can change under it
 * does not belong frozen inside one. The contract now carries `themeKey` — a
 * fact about the float that cannot go stale — and the WINDOW resolves the paint.
 * `FloatChrome` stays card-blind: it receives a resolved tint, never a kind.
 *
 * Called UNCONDITIONALLY (hooks must be): a text-object float has no theme key
 * and still pays the one store read, which is a version-counter compare.
 */
export function useFloatAccent(themeKey: PanelThemeKey | undefined): FloatAccent {
  // The subscription is the point. `useCardTheme(key)` would be the keyed door,
  // but the key is optional here and a hook cannot be conditional — so take the
  // version directly and derive below through the same accent → theme path.
  useThemeVersion();
  return resolveFloatAccent(themeKey);
}

/**
 * The DERIVATION half of `useFloatAccent`, without the subscription.
 *
 * Exported ONLY so a test can state the producer contract ("a note float's
 * declared key resolves to the note theme's `headerDefault`") without restating
 * the accent → theme derivation, which is the fork this task exists to close.
 * **Production code must not call it** — a live read with no subscription is
 * precisely the pre-493 defect, and the census in
 * `float-accent-follows-override.test.tsx` pins that `useFloatAccent` is its
 * only production reader.
 */
export function resolveFloatAccent(
  themeKey: PanelThemeKey | undefined,
): FloatAccent {
  if (!themeKey) return NEUTRAL;
  const theme = themeFromAccent(getPanelColor(themeKey));
  return { headerTint: theme.headerDefault, accentTint: theme.accent };
}
