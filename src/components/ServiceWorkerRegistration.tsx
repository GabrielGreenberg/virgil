"use client";

import { useEffect } from "react";
import { setUpdateAvailable } from "@/hooks/useUpdateAvailable";
import { publicAssetUrl } from "@/lib/public-asset-url";
import { reloadNow } from "@/lib/reload-door";

// The SW URL and its scope both honor the deploy-time prefix, through the ONE
// door (task 365). The SW file itself must live inside its scope (GitHub Pages
// quirk: a SW served from /tools/virgil/sw.js can only control
// /tools/virgil/* — not the parent origin), which is exactly what routing both
// through the same door guarantees.
const SW_URL = publicAssetUrl("/sw.js");
const SW_SCOPE = publicAssetUrl("/");

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let reloadOnControllerChange = false;

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
      // TASK 391 — this is the app's ONLY programmatic reload, and it drops
      // every mounted editor's memory. It is also reachable WITHOUT the user
      // ever touching the update banner: `reloadOnControllerChange` is armed
      // unconditionally at registration, so a controller change from any
      // cause lands here. There is no user in the loop at this point and
      // nothing to defer to, so the door does the one thing it can — flush,
      // then mirror whatever still has not landed — before letting the page
      // go. See `reload-door.ts`.
      void reloadNow(() => window.location.reload());
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  return null;
}
