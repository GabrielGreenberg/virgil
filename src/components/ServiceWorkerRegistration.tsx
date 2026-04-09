"use client";

import { useEffect } from "react";

// Inlined at build time so the SW URL and scope honor the deploy-time
// basePath. The SW file itself must live inside its scope (GitHub Pages
// quirk: a SW served from /tools/virgil/sw.js can only control
// /tools/virgil/* — not the parent origin).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${basePath}/sw.js`, {
        scope: `${basePath}/`,
        updateViaCache: "none",
      });
    }
  }, []);

  return null;
}
