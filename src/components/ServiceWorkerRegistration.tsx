"use client";

import { useEffect } from "react";
import {
  consumeSelfInitiatedUpdate,
  setActivatedElsewhere,
  setUpdateAvailable,
} from "@/hooks/useUpdateAvailable";
import { publicAssetUrl } from "@/lib/public-asset-url";
import {
  installReloadReadinessResponder,
  reloadIfClean,
  reloadNow,
} from "@/lib/reload-door";

// The SW URL and its scope both honor the deploy-time prefix, through the ONE
// door (task 365). The SW file itself must live inside its scope (GitHub Pages
// quirk: a SW served from /tools/virgil/sw.js can only control
// /tools/virgil/* — not the parent origin), which is exactly what routing both
// through the same door guarantees.
const SW_URL = publicAssetUrl("/sw.js");
const SW_SCOPE = publicAssetUrl("/");

// Task 611 — the browser re-checks `sw.js` only on a navigation (and a
// throttled few other events). A Virgil window stays open for days without
// navigating, so it would never learn that a deploy happened. Ask again when
// the window comes back into view, and hourly while it is visible.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export default function ServiceWorkerRegistration() {
  // Task 610 — every window answers other windows' "is your work on disk?"
  // before one of them posts SKIP_WAITING (which reloads all of them).
  useEffect(() => installReloadReadinessResponder(), []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let reloadOnControllerChange = false;
    let stopUpdateChecks: (() => void) | null = null;

    // The SW deliberately does NOT call skipWaiting()/clients.claim()
    // (see public/sw.js). We detect the waiting state and surface an
    // "Update available" banner; the user-driven SKIP_WAITING message
    // is sent from useUpdateAvailable.applyUpdate().
    void navigator.serviceWorker
      .register(SW_URL, {
        scope: SW_SCOPE,
        updateViaCache: "none",
      })
      .then((reg) => {
        if (cancelled) return;

        // Already a waiting SW when we registered (e.g. user reloaded
        // while an update was sitting waiting in another tab).
        if (reg.waiting && navigator.serviceWorker.controller) {
          setUpdateAvailable(reg);
        }

        // A new SW was just discovered — watch its lifecycle.
        const onUpdateFound = () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // "installed" + an existing controller = a new waiting SW
            // (vs. a brand-new install on a controller-less page).
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              setUpdateAvailable(reg);
            }
          });
        };
        reg.addEventListener("updatefound", onUpdateFound);

        const checkForUpdate = () => {
          if (document.hidden) return;
          reg.update().catch(() => {
            // Offline or the server is unreachable — the next check retries.
          });
        };
        const timer = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
        document.addEventListener("visibilitychange", checkForUpdate);
        stopUpdateChecks = () => {
          window.clearInterval(timer);
          document.removeEventListener("visibilitychange", checkForUpdate);
        };

        // When the user accepts the update and the waiting SW activates,
        // navigator.serviceWorker.controller changes. Reload exactly once.
        reloadOnControllerChange = true;
      })
      .catch((err) => {
        console.warn("[sw] registration failed", err);
      });

    const onControllerChange = () => {
      if (!reloadOnControllerChange) return;
      reloadOnControllerChange = false;
      // TASK 391 / 610 — this is the app's ONLY programmatic reload, and it
      // drops every mounted editor's memory. `reloadOnControllerChange` is
      // armed unconditionally at registration, and activation fires this in
      // EVERY window, so most of the time the user who caused it is in some
      // other window. See `reload-door.ts`.
      const reload = () => window.location.reload();
      if (consumeSelfInitiatedUpdate()) {
        // This window's user chose it (clean, or "Update anyway" after every
        // window was asked). Prepare, then go.
        void reloadNow(reload);
        return;
      }
      // Nobody here asked. Reload only if nothing is off disk; otherwise
      // stay on this page (the worker is network-first — the same as a tab
      // left open across a deploy) and let the banner offer the reload.
      void reloadIfClean(reload).then((reloaded) => {
        if (!reloaded) setActivatedElsewhere(() => void reloadNow(reload));
      });
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    return () => {
      cancelled = true;
      stopUpdateChecks?.();
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  return null;
}
