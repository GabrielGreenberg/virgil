"use client";

/**
 * GoatCounter web analytics — privacy-friendly visitor / pageview counts that
 * work on ANY static host, including GitHub Pages (where Vercel's
 * `/_vercel/insights/*` endpoint isn't served, so @vercel/analytics can't
 * collect anything). Loads gc.zgo.at/count.js, which auto-counts one pageview
 * per load and skips localhost by default, so local dev visits don't count.
 *
 * Also fires a custom "pwa-install" event on the global `appinstalled` event —
 * our closest analog to a "download" — covering both the in-app Install button
 * and the browser's own address-bar install UI (`appinstalled` fires once after
 * any successful install, so this never double-counts the button path).
 *
 * Caveat: iOS Safari "Add to Home Screen" does NOT fire `appinstalled`, so
 * install counts undercount on iOS. For a truer "new people this week" number,
 * read unique visitors rather than the pwa-install event.
 */

import { useEffect } from "react";

// Your GoatCounter site code — the subdomain you register at goatcounter.com.
// Registering "virgil" (dashboard → https://virgil.goatcounter.com) means
// setting this to "virgil". It is public (it ships in the page), not a secret.
// While this is empty the component is inert — nothing loads, nothing counts.
const GOATCOUNTER_CODE = "";

declare global {
  interface Window {
    goatcounter?: {
      count?: (vars: { path?: string; title?: string; event?: boolean }) => void;
    };
  }
}

export function Analytics() {
  useEffect(() => {
    if (!GOATCOUNTER_CODE) return;

    // Load the counter once. It auto-counts the initial pageview; because
    // Virgil is effectively a single screen, that pageview-per-load is what
    // gives us visitor / session counts.
    const SRC = "https://gc.zgo.at/count.js";
    if (!document.querySelector(`script[src="${SRC}"]`)) {
      const s = document.createElement("script");
      s.async = true;
      s.src = SRC;
      s.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
      document.head.appendChild(s);
    }

    // PWA install → one custom event (count.js exposes window.goatcounter.count
    // once it has loaded; optional-chaining no-ops if the install fires first).
    const onInstalled = () =>
      window.goatcounter?.count?.({
        path: "pwa-install",
        title: "PWA install",
        event: true,
      });
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  return null;
}
