// @vitest-environment jsdom
// Task 1487 — the dev prefs mirror POSTs only from a browser profile that
// opted in as the promotion source, and every POST carries its source id.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDevPrefsMirror, PREFS_MIRROR_SOURCE_ID_KEY } from "@/lib/dev-prefs-mirror";
import { setFlagOverride, clearFlagOverrides } from "@/lib/feature-flags";

const EDITOR = "virgil-editor-prefs";

describe("useDevPrefsMirror — one declared writer (task 1487)", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_DEV_STORAGE", "true");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    localStorage.clear();
    localStorage.setItem(EDITOR, JSON.stringify({ fontSize: 17 }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearFlagOverrides();
  });

  it("flag OFF (the default — an agent preview) → no POST, no source id minted", async () => {
    const { unmount } = renderHook(() => useDevPrefsMirror());
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(PREFS_MIRROR_SOURCE_ID_KEY)).toBeNull();
    unmount();
  });

  it("flag ON → the POST carries this profile's stable source id and the blobs", async () => {
    setFlagOverride("virgil:prefs-mirror-source", true);
    const { unmount } = renderHook(() => useDevPrefsMirror());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const id = localStorage.getItem(PREFS_MIRROR_SOURCE_ID_KEY);
    expect(id).toBeTruthy();
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(String(init.body));
    expect(body.source).toBe(id);
    expect(body.blobs[EDITOR]).toEqual({ fontSize: 17 });
    unmount();
  });
});
