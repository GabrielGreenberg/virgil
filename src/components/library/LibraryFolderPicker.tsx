"use client";

/**
 * First-time picker shown inside a Library tab when no library folder
 * has been chosen yet. Once the user picks, the handle is persisted and
 * the caller re-renders the tab with the real library view.
 */

import { useState } from "react";
import { pickLibraryFolder } from "@/lib/library/library-folder";

interface Props {
  onPicked: (handle: FileSystemDirectoryHandle) => void;
}

export function LibraryFolderPicker({ onPicked }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      const handle = await pickLibraryFolder();
      onPicked(handle);
    } catch (e) {
      // AbortError is the normal "user cancelled picker" — keep quiet.
      if (e instanceof DOMException && e.name === "AbortError") {
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="max-w-md space-y-4 text-ink-strong">
        <h2 className="text-base font-semibold">Choose your library folder</h2>
        <p className="text-sm leading-relaxed">
          Pick a folder on your disk where Virgil (and Cowork) will keep the
          PDFs referenced by your work. This folder is shared across every
          document you open in Virgil.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={handleClick}
          className="rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
        >
          {busy ? "Waiting…" : "Pick folder"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
