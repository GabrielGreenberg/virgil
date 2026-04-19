"use client";

/**
 * Per-tab gate that holds back rendering of a paper until the user has
 * explicitly re-granted readwrite permission to its folder.
 *
 * Why this exists: the FSA spec only allows `requestPermission()` from
 * inside a real user gesture handler, so we can't just call it from a
 * `useEffect` on page load. The gate renders a single click-to-grant
 * button — the click is the gesture, and only then do we prompt.
 *
 * Background tabs never trigger anything until the user clicks them.
 *
 * Used by EditorLayout to wrap the editor whenever the active doc's
 * stored handle reports `'prompt'` or `'denied'` from queryPermission.
 */

import { useState } from "react";
import { ensureRW } from "@/lib/fsa-permissions";

interface Props {
  /** Display name of the paper, for the UI copy. */
  docName: string;
  /** The directory handle whose permission needs re-granting. */
  handle: FileSystemDirectoryHandle;
  /** Called once permission is granted, to let the parent re-render the editor. */
  onGranted: () => void;
}

export function DocPermissionGate({ docName, handle, onGranted }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      const ok = await ensureRW(handle);
      if (ok) {
        onGranted();
      } else {
        setError(
          "Permission was not granted. Click again and choose Allow in the browser prompt.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="max-w-md space-y-4 text-ink-strong">
        <h2 className="text-base font-semibold">Reconnect to your paper</h2>
        <p className="text-sm leading-relaxed">
          Virgil needs your permission to read and write files in{" "}
          <span className="font-medium">{docName}</span>. Browsers reset this
          permission every time you reopen the page, so you&apos;ll see one
          prompt per paper per session.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={handleClick}
          className="rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
        >
          {busy ? "Waiting…" : "Allow access"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
