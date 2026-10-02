/**
 * pref-css-bootstrap — the pre-paint half of the editor-preferences paint
 * (task 902).
 *
 * The runtime paints a user's preferences onto `:root` from `EditorLayout`'s
 * prefs effect, which runs after mount; until then the page shows the SHIPPED
 * defaults seeded in `globals.css`. For anyone who customised their colours or
 * set a hue/contrast transform, that was a flash of the wrong palette on every
 * load.
 *
 * The fix does not re-implement the resolution in an inline script (a second
 * spelling of the table, the transforms and the derived rows is exactly the
 * drift this task retires). Instead the runtime RECORDS what it painted —
 * the output of `resolvePrefCssVars`, the one resolver — together with the raw
 * stored blobs it was resolved from, and the inline script REPLAYS that record
 * before first paint, but only while those blobs are byte-identical to what is
 * in storage now. A record from other prefs (edited in another window that has
 * not painted yet, cleared storage, a different user) is simply not replayed,
 * and the seed answers as before. With no stored prefs the seed IS the user's
 * palette, so there is nothing to replay.
 */

/** Where the preference blobs live (owned by `usePreferences`). */
export const PREFS_STORAGE_KEY = "virgil-editor-prefs";
export const TRANSFORMS_STORAGE_KEY = "virgil-editor-transforms";

/** The replay record: the custom properties last painted, and the source. */
export const PREF_CSS_CACHE_KEY = "virgil:pref-css-paint";

interface PrefCssPaintRecord {
  /** Raw `virgil-editor-prefs` blob the paint was resolved from. */
  p: string | null;
  /** Raw `virgil-editor-transforms` blob the paint was resolved from. */
  t: string | null;
  /** The painted `[cssVar, value]` pairs, in paint order. */
  v: [string, string][];
}

/**
 * Record a paint for the next load's pre-paint replay. Called by the runtime
 * prefs effect after it has applied `vars` — only on a preference change, never
 * per keystroke. With nothing customised the record is removed (the seed is
 * the palette). Storage failures are swallowed: the record is an optimisation.
 */
export function recordPrefCssPaint(vars: [string, string][]): void {
  try {
    const p = localStorage.getItem(PREFS_STORAGE_KEY);
    const t = localStorage.getItem(TRANSFORMS_STORAGE_KEY);
    if (p === null && t === null) {
      localStorage.removeItem(PREF_CSS_CACHE_KEY);
      return;
    }
    const record: PrefCssPaintRecord = { p, t, v: vars };
    const next = JSON.stringify(record);
    if (localStorage.getItem(PREF_CSS_CACHE_KEY) !== next) {
      localStorage.setItem(PREF_CSS_CACHE_KEY, next);
    }
  } catch {
    // Private mode / quota — the next load falls back to the seed.
  }
}

/** The inline `<script>` body `app/layout.tsx` injects into `<head>`. */
export function prefCssBootstrapScript(): string {
  return (
    "(function(){try{var ls=window.localStorage;" +
    `var r=JSON.parse(ls.getItem(${JSON.stringify(PREF_CSS_CACHE_KEY)})||"null");` +
    "if(!r||!r.v)return;" +
    `if(r.p!==ls.getItem(${JSON.stringify(PREFS_STORAGE_KEY)})||r.t!==ls.getItem(${JSON.stringify(TRANSFORMS_STORAGE_KEY)}))return;` +
    "var s=document.documentElement.style;" +
    "for(var i=0;i<r.v.length;i++){s.setProperty(r.v[i][0],r.v[i][1]);}" +
    "}catch(e){}})();"
  );
}
