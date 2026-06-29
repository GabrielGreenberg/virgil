"use client";

/**
 * Vercel Web Analytics + a single custom "pwa_install" event.
 *
 * <VercelAnalytics/> (from @vercel/analytics/next, the App-Router-aware
 * variant) injects Vercel's privacy-friendly insights script: page views and
 * unique visitors, no cookies, no consent banner. It no-ops in local dev and
 * only sends data once deployed on Vercel with Web Analytics enabled for the
 * project.
 *
 * The `appinstalled` listener fires ONE custom event per PWA install — our
 * closest analog to a "download" — regardless of whether the user installed via
 * the InstallPwaPrompt button or the browser's own address-bar install UI
 * (`appinstalled` fires once, after any successful install, so this never
 * double-counts the button path).
 *
 * Caveat: iOS Safari "Add to Home Screen" does NOT fire `appinstalled`, so
 * install counts undercount on iOS. For a truer "new people this week" number,
 * read unique visitors rather than the pwa_install event.
 */

import { useEffect } from "react";
import { Analytics as VercelAnalytics } from "@vercel/analytics/next";
import { track } from "@vercel/analytics";

export function Analytics() {
  useEffect(() => {
    const onInstalled = () => track("pwa_install");
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  return <VercelAnalytics />;
}
