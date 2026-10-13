"use client";

/**
 * Per-tab gate shown in place of a paper Virgil cannot reach (task 1102) —
 * the sibling of `DocPermissionGate`, in the same slot and the same card
 * shape. Before it, a paper whose folder had been moved, renamed or deleted
 * opened to a silent blank pane, and nothing in the UI could forget it.
 *
 * Three ways out:
 *   - **Locate folder…** re-picks the folder (the click is the gesture the
 *     picker needs) and re-points the paper at it under the SAME id, so its
 *     sidecars, My Papers and Recents membership survive the move.
 *   - **Try again** re-checks — the folder may have been put back in Finder.
 *   - **Remove from Recents** forgets the paper. It never touches the disk.
 */

import { useState } from "react";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import type { DocLoadFailureKind } from "@/lib/doc-load-failure";

interface Props {
  /** Display name of the paper. */
  docName: string;
  /** The folder the paper was last seen in, for the copy. */
  folderName: string;
  /** The paper's main `.tex`, for the copy. */
  texFilename: string;
  kind: DocLoadFailureKind;
  /** Underlying error message, shown small. */
  detail?: string;
  /** Pick a folder and re-point the paper at it. Omitted where no picker
   *  exists (dev storage) — the button is then not offered. Rejects with a
   *  user-facing message when the picked folder is wrong. */
  onLocate?: () => Promise<void>;
  /** Re-run the reachability check. */
  onRetry: () => void;
  /** Forget the paper (index row + tab). Never deletes files. */
  onRemove: () => Promise<void>;
}

/** The headline + body copy per kind — one table, read by the gate. */
export function unreachableCopy(
  kind: DocLoadFailureKind,
  folderName: string,
  texFilename: string,
): { title: string; body: string } {
  switch (kind) {
    case "folder-missing":
      return {
        title: "Virgil can't find this paper's folder",
        body: `The folder “${folderName}” may have been moved, renamed or deleted. Point Virgil at its new location, or remove the paper from Recents.`,
      };
    case "tex-missing":
      return {
        title: "Virgil can't find this paper's file",
        body: `The folder “${folderName}” no longer contains ${texFilename}. Point Virgil at the folder that has it, or remove the paper from Recents.`,
      };
    case "permission":
      return {
        title: "Virgil isn't allowed to open this paper",
        body: `The browser refused access to “${folderName}”. Locate the folder again to grant access, or remove the paper from Recents.`,
      };
    case "unreadable":
      return {
        title: "Virgil couldn't open this paper",
        body: `Something went wrong reading “${folderName}”. Try again, locate the folder again, or remove the paper from Recents.`,
      };
  }
}

export function DocUnreachableGate({
  docName,
  folderName,
  texFilename,
  kind,
  detail,
  onLocate,
  onRetry,
  onRemove,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"locate" | "remove" | null>(null);
  const copy = unreachableCopy(kind, folderName, texFilename);

  async function run(which: "locate" | "remove", action: () => Promise<void>) {
    setError(null);
    setBusy(which);
    try {
      await action();
    } catch (e) {
      // The user dismissing the picker is not an error worth saying.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="flex h-full w-full items-center justify-center p-6"
      data-testid="doc-unreachable-gate"
      data-kind={kind}
    >
      <div className="max-w-md space-y-4 text-ink-strong">
        <h2 className="text-base font-semibold">{copy.title}</h2>
        <p className="text-sm leading-relaxed">
          <span className="font-medium">{docName}</span>: {copy.body}
        </p>
        <div className="flex flex-wrap gap-2">
          {onLocate && (
            <Button
              variant="primary"
              size="md"
              disabled={busy !== null}
              onClick={() => run("locate", onLocate)}
            >
              {busy === "locate" ? "Waiting…" : "Locate folder…"}
            </Button>
          )}
          <Button
            variant="secondary"
            size="md"
            disabled={busy !== null}
            onClick={onRetry}
          >
            Try again
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={busy !== null}
            onClick={() => run("remove", onRemove)}
          >
            Remove from Recents
          </Button>
        </div>
        <p className="text-xs text-ink-subtle">
          Removing only forgets the paper in Virgil — no files are deleted.
        </p>
        {detail && <p className="text-xs text-ink-subtle break-words">{detail}</p>}
        {error && <InlineError>{error}</InlineError>}
      </div>
    </div>
  );
}
