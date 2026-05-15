"use client";

import { useEffect } from "react";
import { setUpdateAvailable } from "@/hooks/useUpdateAvailable";

// Inlined at build time so the SW URL and scope honor the deploy-time
// basePath. The SW file itself must live inside its scope (GitHub Pages
// quirk: a SW served from /tools/virgil/sw.js can only control
// /tools/virgil/* — not the parent origin).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

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
      .register(`${basePath}/sw.js`, {
        scope: `${basePath}/`,
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
      window.location.reload();
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
