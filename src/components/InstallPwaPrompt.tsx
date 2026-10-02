"use client";

/**
 * Tiny "Install Virgil" button on the empty state. Two reasons to install:
 *   - Chrome 122+ allows installed PWAs to persist FSA permissions, so
 *     reopening a paper doesn't re-prompt every page load.
 *   - The dock/start-menu launcher gets you back to your papers faster.
 *
 * The browser's install offer is owned by `@/lib/install-prompt` (armed at
 * app bootstrap, so it is heard even if a paper was open at load — task 889);
 * this component only reads it.
 *
 * Renders nothing if:
 *   - the browser has not offered installation this page load (unsupported,
 *     already installed / ineligible), or the offer was spent — by a prompt
 *     of either outcome, or by `appinstalled`
 *   - the app is currently running in an installed display mode (this very
 *     window IS the PWA)
 *   - the user has dismissed it with × — PERMANENTLY (a localStorage flag,
 *     never reset): the less naggy choice; the address-bar install remains.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { isDevStorage } from "@/lib/storage-mode";
import { useWindowChrome } from "@/hooks/useWindowChrome";
import {
  armInstallPromptCapture,
  getInstallPrompt,
  promptInstall,
  subscribeInstallPrompt,
} from "@/lib/install-prompt";

const DISMISSED_KEY = "virgil:install-prompt-dismissed";

const getServerInstallPrompt = () => null;

export function InstallPwaPrompt() {
  const evt = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPrompt,
    getServerInstallPrompt,
  );
  const [dismissed, setDismissed] = useState(false);
  // Single source of truth for display mode (was a one-shot matchMedia read).
  // Any installed mode (standalone / WCO / fullscreen) means "this window IS
  // the PWA", so the install prompt is moot.
  const { displayMode } = useWindowChrome();
  const installed = displayMode !== "browser";

  useEffect(() => {
    // Idempotent; the bootstrap arm (ServiceWorkerRegistration) normally won.
    armInstallPromptCapture();
    if (installed) return;
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
  }, [installed]);

  if (isDevStorage) return null;
  if (installed || !evt || dismissed) return null;

  return (
    <div className="flex items-center gap-2 text-[11px] text-ink-subtle">
      <button
        type="button"
        onClick={() => void promptInstall()}
        className="underline hover:text-ink-strong"
      >
        Install Virgil
      </button>
      <span>for one-click reopens.</span>
      <button
        data-iconbtn-exempt="inline text glyph sized by its text line, not a box"
        type="button"
        onClick={() => {
          localStorage.setItem(DISMISSED_KEY, "1");
          setDismissed(true);
        }}
        className="text-ink-subtle hover:text-ink-strong focus-ring"
        aria-label="Dismiss install prompt"
      >
        ×
      </button>
    </div>
  );
}
