"use client";

import { useEffect } from "react";
import { useExternalChangesOrNull } from "@/hooks/useExternalChanges";

/**
 * ExternalChangeActiveReporter — a headless reporter that lifts the
 * external-change badge's "is anything showing?" boolean up into EditorLayout.
 *
 * EditorLayout's own body sits ABOVE the DiskWatcherProvider in the React tree,
 * so it can't call `useExternalChanges()` to gate the topbar divider. This tiny
 * component IS a provider descendant (it renders inside the status cluster), so
 * it can read the live state via `useExternalChangesOrNull` (nullable — works
 * with no doc/provider) and push `state.severity != null` up through
 * `onActiveChange`. Renders nothing.
 *
 * KEYSTROKE SANCTITY: it reads `useSyncExternalStore` over the watcher's stable
 * snapshot — NOT any editor subscription — and fires `onActiveChange` only when
 * the boolean flips. Zero per-keystroke work.
 */
export function ExternalChangeActiveReporter({
  onActiveChange,
}: {
  onActiveChange: (active: boolean) => void;
}): null {
  const { state } = useExternalChangesOrNull();
  const active = state.severity != null;
  useEffect(() => {
    onActiveChange(active);
  }, [active, onActiveChange]);
  // Reset the lifted boolean when this reporter unmounts (e.g. the topbar-right
  // cluster collapses), so a stale `true` can't outlive the live state.
  useEffect(() => () => onActiveChange(false), [onActiveChange]);
  return null;
}
