"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  getAllLinkStates,
  getLinkState,
  getPrefLinksVersion,
  linkId,
  loadPrefLinks,
  setLinkField,
  subscribePrefLinks,
  type LinkableKey,
  type LinkId,
  type LinkState,
} from "@/lib/pref-links";

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

/*
 * There is deliberately no `useLinkAwareUpdater` here any more (task 625).
 * Wrapping the writer at the call site made the cascade OPT-IN, and only one of
 * the preferences dialog's sections opted in — so the same preference cascaded
 * or didn't depending on which control you edited it through. The cascade now
 * lives inside `usePreferences.updatePref`, the single door that writes a
 * preference, and `propagate` (in `lib/pref-links`) is its one implementation.
 */
