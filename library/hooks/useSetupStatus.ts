"use client";

import { useEffect, useRef, useState } from "react";
import { readJsonFile, VIRGIL_DIR } from "@library/lib/library-storage";
import type { NotificationItem } from "@library/lib/queue";

const MANIFEST_PATH = `${VIRGIL_DIR}/models/manifest.json`;
const POLL_MS = 30_000;

interface SetupManifest {
  schemaVersion?: number;
  setupAt?: string;
  modelsCache?: string;
  tools?: Record<
    string,
    { installed?: boolean; version?: string | null; system?: boolean }
  >;
}

export interface SetupStatus {
  /** True iff the manifest is missing OR any heavy tool is uninstalled. */
  needed: boolean;
  /** Names of the tools that are missing (empty if none). */
  missing: string[];
  /** Single notification surfaced to the Toaster when setup is needed.
   *  Empty array when setup is complete — the consumer can just
   *  `.concat()` this with the inbox stream without conditional logic. */
  notice: NotificationItem[];
}

const OK_STATUS: SetupStatus = { needed: false, missing: [], notice: [] };

/**
 * Polls `.virgil/models/manifest.json` and surfaces a synthetic notification
 * when the library hasn't run `/library/setup` (or has run it but tools
 * are missing — e.g. tesseract not yet installed system-wide).
 *
 * No disk writes — the notification is in-memory only. The Toaster's
 * seenAt dedupe keys off `at + kind + citekey`, so we use a single
 * stable timestamp per "needed" episode (set when the gap first
 * appears) so the toast fires once per session, not on every poll.
 */
export function useSetupStatus(
  handle: FileSystemDirectoryHandle | null,
): SetupStatus {
  const [status, setStatus] = useState<SetupStatus>(OK_STATUS);
  // Stable `at` for the in-memory notification; held across polls so the
  // Toaster dedupes it after the first surface.
  const firstSeenAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      const manifest = await readJsonFile<SetupManifest>(handle, MANIFEST_PATH);
      const missing = computeMissing(manifest);
      if (missing.length === 0) {
        firstSeenAtRef.current = null;
        setStatus(OK_STATUS);
        return;
      }
      if (firstSeenAtRef.current === null) {
        firstSeenAtRef.current = new Date().toISOString();
      }
      const summary = manifest
        ? `Library setup incomplete — missing: ${missing.join(", ")}. Run /library/setup.`
        : `Library is missing extraction models. Run /library/setup to install marker-pdf + ocrmypdf and cache the ML weights locally.`;
      setStatus({
        needed: true,
        missing,
        notice: [
          {
            kind: "setup-needed",
            at: firstSeenAtRef.current,
            summary,
          },
        ],
      });
    };

    void tick();
    const interval = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [handle]);

  return status;
}

function computeMissing(manifest: SetupManifest | undefined): string[] {
  // No manifest at all → setup hasn't run; all heavy tools are notionally
  // missing. Caller only needs to see the headline though, so report the
  // names that the install script tracks.
  if (!manifest) return ["marker-pdf", "ocrmypdf", "tesseract"];
  const tools = manifest.tools ?? {};
  const out: string[] = [];
  for (const [name, info] of Object.entries(tools)) {
    if (!info?.installed) out.push(name);
  }
  return out;
}
