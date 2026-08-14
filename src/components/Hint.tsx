"use client";

/**
 * The ergonomic React surface over the hint attribute protocol. The actual
 * rendering is done once, app-wide, by {@link HintLayer} — these helpers
 * only stamp `data-hint*` attributes onto an element. That keeps hints
 * stateless and free: no per-element listeners, timers, or portals.
 *
 *   const hint = useHint({ label: "Open actions menu", keys: "Mod+/" });
 *   <button {...hint}>Actions</button>
 *
 * or, to wrap an existing element without touching its props:
 *
 *   <Hint label="Delete" keys="Backspace"><IconButton …/></Hint>
 *
 * For an ICON-ONLY control the label is also its accessible name, so it goes
 * through {@link iconHint} instead — one string, both consumers:
 *
 *   <button {...iconHint({ label: "Close tab" })}><IconX /></button>
 *
 * `keys` is a portable shortcut string (see {@link Kbd}); `pos` nudges the
 * preferred placement (default: below, flipping/clamping to fit).
 */

import { cloneElement, useMemo, type ReactElement } from "react";

export type HintPos = "above" | "below" | "left" | "right";

export interface HintOptions {
  /** The tooltip text. Optional — omit for a shortcut-only hint (just the
   *  keycap), e.g. the ⚡ button showing only "⌘/". */
  label?: string;
  /** Optional portable shortcut, e.g. "Mod+/" — rendered as a keycap. */
  keys?: string;
  /** Preferred placement; flips/clamps to stay on-screen. */
  pos?: HintPos;
}

export interface HintAttributes {
  "data-hint"?: string;
  "data-hint-keys"?: string;
  "data-hint-pos"?: HintPos;
}

/** Returns spreadable `data-hint*` attributes for any element. Provide a
 *  `label`, `keys`, or both. */
export function useHint({ label, keys, pos }: HintOptions): HintAttributes {
  return useMemo(() => {
    const attrs: HintAttributes = {};
    if (label) attrs["data-hint"] = label;
    if (keys) attrs["data-hint-keys"] = keys;
    if (pos) attrs["data-hint-pos"] = pos;
    return attrs;
  }, [label, keys, pos]);
}

export interface IconHintOptions extends Omit<HintOptions, "label"> {
  /** The control's accessible name — and, unless `hint` overrides it, the
   *  text of its tooltip. */
  label: string;
  /** Tooltip text, for the rare control whose visible tooltip must say more
   *  (or less) than its name — `iconHint({ label: "Dismiss skill-sync error",
   *  hint: "Dismiss" })`. Still ONE call site, so the two cannot drift apart
   *  without someone deciding they should. */
  hint?: string;
}

export type IconHintAttributes = HintAttributes & { "aria-label": string };

/**
 * The hint protocol for an ICON-ONLY control: the `data-hint*` attributes
 * **and** the accessible name, from one `label`.
 *
 * `data-hint` is a CSS-tooltip hook, not an accessible name (STYLE_GUIDE
 * "Accessible names"), so an icon-only button carrying only the hint
 * announces as a bare "button" — WCAG 4.1.2. The two attributes were
 * therefore hand-paired at ~50 sites, which is one string spelled twice with
 * nothing holding the copies together: `StatusCluster`'s toolbar toggle
 * already announced "Expand toolbar" while its tooltip said "Collapse
 * toolbar", silently, for as long as that conditional had existed. One
 * argument, both consumers.
 *
 * A plain function rather than a hook, deliberately: the close buttons in
 * `TabStrip` (and every other per-row control) are built inside a `.map`,
 * where a hook cannot go. Nothing is lost — the result is spread straight
 * onto a DOM element, so its identity is never compared.
 */
export function iconHint({
  label,
  hint,
  keys,
  pos,
}: IconHintOptions): IconHintAttributes {
  const attrs: IconHintAttributes = { "aria-label": label };
  const tooltip = hint ?? label;
  if (tooltip) attrs["data-hint"] = tooltip;
  if (keys) attrs["data-hint-keys"] = keys;
  if (pos) attrs["data-hint-pos"] = pos;
  return attrs;
}

/** Wraps a single child element, injecting the hint attributes onto it. */
export function Hint({
  label,
  keys,
  pos,
  children,
}: HintOptions & { children: ReactElement }): ReactElement {
  const attrs = useHint({ label, keys, pos });
  return cloneElement(children, attrs);
}
