// @vitest-environment jsdom
//
// Task 768 — the collaborator identity is per-BROWSER (one localStorage key),
// but `useCollab` cached it in hook state on mount and never heard a peer
// window's "Edit identity". Window B then heartbeated, claimed and released the
// pen under the OLD name, and could show its own user as their partner.
//
// These legs simulate the peer window's write the way the browser delivers it
// — the value lands in storage, then a `storage` event fires in THIS window —
// and ask whether the hook's identity follows without a remount.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  readSidecar: async (_docId: string, _f: string, fallback: unknown) => fallback,
  writeSidecar: async () => {},
  readTextFile: async () => null,
}));

import { useCollab } from "../useCollab";
import { COLLAB_IDENTITY_KEY, saveIdentity } from "@/lib/collab";

/** A peer window saves `value` under `key`: storage changes, then THIS window
 *  hears the event (the writing window itself never does). */
function peerWrites(key: string, value: string | null) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  window.dispatchEvent(
    new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }),
  );
}

describe("useCollab — identity re-hydrates across windows (task 768)", () => {
  beforeEach(() => {
    localStorage.clear();
    saveIdentity({ name: "Ada", color: "#112233" });
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("a peer window's identity edit reaches this window without a remount", () => {
    const { result } = renderHook(() => useCollab("doc-1"));
    expect(result.current.identity).toEqual({ name: "Ada", color: "#112233" });

    act(() =>
      peerWrites(COLLAB_IDENTITY_KEY, JSON.stringify({ name: "Ada L.", color: "#445566" })),
    );
    expect(result.current.identity).toEqual({ name: "Ada L.", color: "#445566" });
  });

  it("a peer clearing the identity clears it here too", () => {
    const { result } = renderHook(() => useCollab("doc-1"));
    act(() => peerWrites(COLLAB_IDENTITY_KEY, null));
    expect(result.current.identity).toBeNull();
  });

  it("a foreign key does not disturb the identity", () => {
    const { result } = renderHook(() => useCollab("doc-1"));
    const before = result.current.identity;
    act(() => peerWrites("some-other-key", "x"));
    expect(result.current.identity).toBe(before);
  });

  it("a local setIdentity still updates this window (no storage event needed)", () => {
    const { result } = renderHook(() => useCollab("doc-1"));
    act(() => result.current.setIdentity({ name: "Grace", color: "#abcdef" }));
    expect(result.current.identity).toEqual({ name: "Grace", color: "#abcdef" });
  });
});
