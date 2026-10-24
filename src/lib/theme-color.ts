/**
 * theme-color — the ONE source of the browser/PWA chrome colour (task 1274).
 *
 * The OS/browser chrome (the tab strip tint, the installed PWA's title bar and
 * the WCO control strip) is painted from `<meta name="theme-color">` and, for
 * the installed app's splash/title, the manifest's `theme_color`. It must read
 * as the in-app top bar, so it IS the top bar's colour: whatever the prefs
 * paint into `--topbar-bg`. That value used to be spelled four times with three
 * different hexes (manifest, the layout meta, a dead `--theme-color` alias,
 * and the pref default), so every launch showed a stale strip until
 * EditorLayout's post-mount writer ran. Now there is one value per phase:
 *
 *  - STATIC (manifest + the meta's server-rendered `content`):
 *    `DEFAULT_THEME_COLOR`, the runtime's paint at the shipped defaults —
 *    the same value the PROMOTE-DEFAULTS seed gives `--topbar-bg`.
 *  - PRE-PAINT: `prefCssBootstrapScript` replays the recorded paint and writes
 *    the meta from its `THEME_COLOR_CSS_VAR` row.
 *  - RUNTIME: EditorLayout's prefs effect writes the meta from the same row of
 *    the `resolvePrefCssVars` output it paints (`themeColorFromVars`).
 */
import { DEFAULT_PREFS } from "@/hooks/preferences-defaults";
import { applyTransforms, DEFAULT_TRANSFORMS } from "@/lib/color-transforms";

/** The painted custom property the chrome colour follows. */
export const THEME_COLOR_CSS_VAR = "--topbar-bg";

/** The meta the browser/OS chrome reads. */
export const THEME_COLOR_META_SELECTOR = 'meta[name="theme-color"]';

/**
 * The chrome colour at the shipped defaults — what `resolvePrefCssVars`
 * paints into `--topbar-bg` for `DEFAULT_PREFS` (a colour row: the default
 * transforms applied to the raw pref).
 */
export const DEFAULT_THEME_COLOR: string = applyTransforms(
  DEFAULT_PREFS.topbarBackground,
  DEFAULT_TRANSFORMS,
);

/** The chrome colour within a resolved paint, or null if it carries none. */
export function themeColorFromVars(
  vars: ReadonlyArray<readonly [string, string]>,
): string | null {
  for (const [cssVar, value] of vars) {
    if (cssVar === THEME_COLOR_CSS_VAR) return value;
  }
  return null;
}

/** Point the browser/OS chrome at `color`. No-op without a meta or a colour. */
export function writeThemeColorMeta(color: string | null): void {
  if (!color) return;
  const meta = document.querySelector(THEME_COLOR_META_SELECTOR);
  if (meta && meta.getAttribute("content") !== color) {
    meta.setAttribute("content", color);
  }
}
