"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  getAllLinkStates,
  getLinkState,
  getPrefLinksVersion,
  linkId,
  loadPrefLinks,
  propagate,
  setLinkField,
  subscribePrefLinks,
  type LinkableKey,
  type LinkId,
  type LinkState,
} from "@/lib/pref-links";
import type { EditorPreferences } from "@/hooks/usePreferences";

function useLinksVersion(): number {
  return useSyncExternalStore(
    subscribePrefLinks,
    getPrefLinksVersion,
    () => 0,
  );
}

export function useLoadPrefLinks() {
  useEffect(() => {
    loadPrefLinks();
  }, []);
}

/** Look up the live state for one link; returns undefined if none registered. */
export function useLinkState(parent: LinkableKey, child: LinkableKey): LinkState | undefined {
  useLinksVersion();
  return getLinkState(linkId(parent, child));
}

export function useAllLinkStates(): Record<LinkId, LinkState> {
  useLinksVersion();
  return getAllLinkStates();
}

export function setLinkLocked(parent: LinkableKey, child: LinkableKey, locked: boolean) {
  setLinkField(linkId(parent, child), "locked", locked);
}

export function setLinkDelta(parent: LinkableKey, child: LinkableKey, deltaL: number) {
  setLinkField(linkId(parent, child), "deltaL", deltaL);
}

/**
 * Wrap an `updatePref` callback so that writes to a linked parent also
 * update every locked descendant. When the key isn't linked, behaves
 * exactly like the raw updater.
 */
export function useLinkAwareUpdater(
  rawUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void,
) {
  // Version subscription so the closure re-creates when link state changes.
  useLinksVersion();
  return useCallback(
    <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => {
      rawUpdate(key, value);
      if (typeof value !== "string") return;
      const cascades = propagate(key as LinkableKey, value as string);
      for (const [k, v] of Object.entries(cascades)) {
        rawUpdate(k as K, v as EditorPreferences[K]);
      }
    },
    [rawUpdate],
  );
}
