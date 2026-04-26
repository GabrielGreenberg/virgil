"use client";

/**
 * Gate shown inside a Library tab when the stored library-folder handle
 * reports `'prompt'` or `'denied'` — i.e. the user picked the folder in a
 * previous session and we need them to click to re-grant access.
 *
 * Mirrors DocPermissionGate but for the single global library folder.
 */

import { useState } from "react";
import { ensureRW } from "@/lib/fsa-permissions";
import { Button } from "@/components/panel-primitives";

interface Props {
  handle: FileSystemDirectoryHandle;
  onGranted: () => void;
}

export function LibraryPermissionGate({ handle, onGranted }: Props) {
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
        <h2 className="text-base font-semibold">Reconnect to your library</h2>
        <p className="text-sm leading-relaxed">
          Virgil needs your permission to read the library folder{" "}
          <span className="font-medium">{handle.name}</span>. Browsers reset this
          permission every time you reopen the page.
        </p>
        <Button
          variant="primary"
          size="md"
          disabled={busy}
          onClick={handleClick}
        >
          {busy ? "Waiting…" : "Allow access"}
        </Button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
