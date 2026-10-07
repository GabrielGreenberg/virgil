"use client";

/**
 * # The ONE door for "copy to clipboard, flash ✓, flip back"
 *
 * Four components hand-rolled this three ways (task 984): only one armed its
 * reset timer through the component's lifetime, three left a denied
 * `clipboard.writeText` (insecure context, iframe, revoked permission) as an
 * unhandled promise rejection, and the flash ran 1200 ms in one place and
 * 1500 ms in the others.
 *
 * The hook owns all three facts:
 *
 * - **Lifetime.** The reset is scheduled through the component's ONE
 *   `useViewLifetime` scope, and the post-promise `setCopied(true)` checks
 *   `disposed` first — the promise resolves off the microtask queue, so a
 *   component torn down between the click and the resolve must neither update
 *   state nor arm a timer (`docs/agents/laws/a-nodeview-owns-its-timers-lifetime.md`,
 *   the React half).
 * - **Rejection.** A failed write is caught here. The flash simply does not
 *   show; there is nothing a copy button can usefully do about a refused
 *   permission.
 * - **Duration.** One default, `COPY_FLASH_MS`.
 */

import { useCallback, useRef, useState } from "react";
import { useViewLifetime } from "@/hooks/useViewLifetime";
import type { ViewTimer } from "@/lib/tiptap/view-lifetime";

/** How long the "copied" state shows after a successful write. */
export const COPY_FLASH_MS = 1500;

export interface CopyFlash {
  /** True for `ms` after a successful copy. */
  copied: boolean;
  /** Write `text` to the clipboard; resolves once the attempt settles. Never rejects. */
  copy: (text: string) => Promise<void>;
}

export function useCopyFlash(ms: number = COPY_FLASH_MS): CopyFlash {
  const lifetime = useViewLifetime();
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ViewTimer | null>(null);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return;
      }
      if (lifetime.disposed) return;
      setCopied(true);
      // A second copy inside the window restarts the flash rather than letting
      // the first copy's reset cut the second one short.
      lifetime.clear(resetRef.current);
      resetRef.current = lifetime.setTimeout(() => setCopied(false), ms);
    },
    [lifetime, ms],
  );

  return { copied, copy };
}
