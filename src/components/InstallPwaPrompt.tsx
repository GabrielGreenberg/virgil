"use client";

/**
 * Tiny "Install Virgil" button on the empty state. Two reasons to install:
 *   - Chrome 122+ allows installed PWAs to persist FSA permissions, so
 *     reopening a paper doesn't re-prompt every page load.
 *   - The dock/start-menu launcher gets you back to your papers faster.
 *
 * Renders nothing if:
 *   - `beforeinstallprompt` hasn't fired (browser doesn't support it,
 *     or the app is already installed / ineligible)
 *   - the app is currently running in standalone display mode (already
 *     installed, this very window IS the PWA)
 *   - the user has dismissed the prompt this session.
 */

import { useEffect, useState } from "react";
import { isDevStorage } from "@/lib/storage-mode";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "virgil:install-prompt-dismissed";

export function InstallPwaPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (isDevStorage) return null;
  if (!evt || dismissed) return null;

  return (
    <div className="flex items-center gap-2 text-[11px] text-ink-subtle">
      <button
        type="button"
        onClick={async () => {
          await evt.prompt();
          const choice = await evt.userChoice;
          if (choice.outcome === "accepted") {
            setEvt(null);
          }
        }}
        className="underline hover:text-ink-strong"
      >
        Install Virgil
      </button>
      <span>for one-click reopens.</span>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(DISMISSED_KEY, "1");
          setDismissed(true);
        }}
        className="text-ink-subtle hover:text-ink-strong"
        aria-label="Dismiss install prompt"
      >
        ×
      </button>
    </div>
  );
}
