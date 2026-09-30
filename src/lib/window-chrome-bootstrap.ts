import { flagBootstrapExpr } from "@/lib/feature-flags";

/**
 * window-chrome-bootstrap — the pre-paint half of `useWindowChrome`.
 *
 * `app/layout.tsx` inlines this script so `html[data-display-mode]` is stamped
 * from the real `matchMedia` (and the WCO debug switch) BEFORE first paint;
 * `useWindowChrome._compute()` then keeps the attribute live. The two must
 * agree on when debug mode is ON, or first paint shows the real display mode
 * and then flips — the very flash the bootstrap exists to prevent (task 846).
 * So neither spells the rule: the flag half is emitted from the flag SSOT
 * (`flagBootstrapExpr`), and the query-param half is this one constant.
 */

/** A URL containing this substring forces WCO debug mode (`?wco-debug`). */
export const WCO_DEBUG_PARAM = "wco-debug";

/** The inline `<script>` body `app/layout.tsx` injects into `<head>`. */
export function displayModeBootstrapScript(): string {
  return (
    "(function(){try{var d=document.documentElement;var dbg=false;" +
    `try{dbg=${flagBootstrapExpr("virgil:wco-debug")};}catch(e){}` +
    `dbg=dbg||location.search.indexOf(${JSON.stringify(WCO_DEBUG_PARAM)})!==-1;` +
    "var m=function(q){return typeof window.matchMedia==='function'&&window.matchMedia(q).matches;};" +
    "var mode=dbg?'window-controls-overlay':m('(display-mode: window-controls-overlay)')?'window-controls-overlay':m('(display-mode: fullscreen)')?'fullscreen':m('(display-mode: standalone)')?'standalone':'browser';" +
    "d.setAttribute('data-display-mode',mode);}catch(e){}})();"
  );
}
