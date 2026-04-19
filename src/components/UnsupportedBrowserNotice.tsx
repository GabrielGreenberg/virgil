"use client";

/**
 * Full-screen notice shown when the current browser doesn't support the
 * File System Access API. Virgil's storage layer assumes FSA, so there's
 * no fallback path — the user has to switch browsers.
 *
 * As of 2026, FSA ships in Chrome, Edge, Opera, Brave, Arc, and Vivaldi.
 * Firefox and Safari do not (and have no public commitment to). Mobile
 * Chrome on Android supports it; mobile Safari does not.
 */
export function UnsupportedBrowserNotice() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-muted p-6">
      <div className="max-w-lg space-y-4 text-ink-strong">
        <h1 className="text-xl font-semibold">Virgil needs a Chromium browser</h1>
        <p className="text-sm leading-relaxed">
          Virgil stores your papers as ordinary files on your own disk, using
          the browser&apos;s File System Access API. Your current browser
          doesn&apos;t support it.
        </p>
        <p className="text-sm leading-relaxed">
          Open this page in a recent version of{" "}
          <span className="font-medium">Chrome</span>,{" "}
          <span className="font-medium">Edge</span>,{" "}
          <span className="font-medium">Brave</span>,{" "}
          <span className="font-medium">Arc</span>, or another Chromium-based
          browser to continue.
        </p>
        <p className="text-xs text-ink-subtle">
          Nothing you do here is uploaded — Virgil is a fully client-side app.
          The browser requirement is purely about disk access.
        </p>
      </div>
    </div>
  );
}
