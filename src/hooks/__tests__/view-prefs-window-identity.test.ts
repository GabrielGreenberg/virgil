// @vitest-environment jsdom
/**
 * Task 930 — the per-window view-prefs blob takes the same identity door as
 * the tab records (`settleWindowStartup`): SEED from the inherited id,
 * PERSIST under the claimed id, SWEEP only windows that are not alive.
 *
 *   - a duplicated tab's inherited layout is written under its re-minted id
 *     with no setter call, so its first reload keeps the layout;
 *   - the GC index stamps the CLAIMED id, and GC never evicts the blob of a
 *     window in the live set, however old its last load.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ID_KEY = "virgil-window-id";
const PREFIX = "virgil-view-prefs/window/";
const INDEX = "virgil-view-prefs/window-index";
const DAY = 24 * 60 * 60 * 1000;

/** A LockManager shared by every "window": names held for the page's life,
 *  `ifAvailable` answering `null` when already held. */
function fakeLocks() {
  const held = new Set<string>();
  return {
    held,
    request: vi.fn(
      async (
        name: string,
        optsOrCb: unknown,
        maybeCb?: (lock: { name: string } | null) => unknown,
      ) => {
        const cb = (maybeCb ?? optsOrCb) as (l: { name: string } | null) => unknown;
        const ifAvailable =
          typeof optsOrCb === "object" &&
          (optsOrCb as { ifAvailable?: boolean }).ifAvailable;
        if (held.has(name)) {
          if (ifAvailable) return cb(null);
          return new Promise(() => {});
        }
        held.add(name);
        return cb({ name });
      },
    ),
    query: vi.fn(async () => ({
      held: [...held].map((name) => ({ name })),
      pending: [],
    })),
  };
}

/** One "window": fresh module instances over the SHARED sessionStorage,
 *  localStorage and LockManager — exactly a duplicated tab. */
async function openWindow() {
  vi.resetModules();
  const live = await import("@/lib/multi-window/window-liveness");
  const prefs = await import("@/hooks/useViewPrefs");
  const startup = await live.settleWindowStartup();
  return { startup, prefs };
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal("navigator", { ...navigator, locks: fakeLocks() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("per-window view prefs follow the identity claim", () => {
  it("TWIN — the inherited layout lands under the re-minted id without any setter", async () => {
    sessionStorage.setItem(ID_KEY, "source");
    const layout = JSON.stringify({ dockedOmni: "left", __future: 1 });
    localStorage.setItem(PREFIX + "source", layout);

    await openWindow(); // the source window holds `source`
    const twin = await openWindow(); // Duplicate tab: same sessionStorage
    const { id, inheritedId } = twin.startup.identity;
    expect(inheritedId).toBe("source");
    expect(id).not.toBe("source");

    twin.prefs.adoptInheritedWindowPrefs(twin.startup.identity);
    // Byte-for-byte, carried (unknown) keys included.
    expect(localStorage.getItem(PREFIX + id)).toBe(layout);
    expect(localStorage.getItem(PREFIX + "source")).toBe(layout);
  });

  it("TWIN — a blob the twin already wrote under its new id is not overwritten", async () => {
    localStorage.setItem(PREFIX + "source", '{"a":1}');
    localStorage.setItem(PREFIX + "fresh", '{"a":2}');
    const { adoptInheritedWindowPrefs } = await import("@/hooks/useViewPrefs");
    adoptInheritedWindowPrefs({ id: "fresh", inheritedId: "source" });
    expect(localStorage.getItem(PREFIX + "fresh")).toBe('{"a":2}');
  });

  it("FREE — a plain reload (id kept) copies nothing", async () => {
    sessionStorage.setItem(ID_KEY, "solo");
    localStorage.setItem(PREFIX + "solo", '{"a":1}');
    const w = await openWindow();
    expect(w.startup.identity).toEqual({ id: "solo", inheritedId: "solo" });
    const before = localStorage.length;
    w.prefs.adoptInheritedWindowPrefs(w.startup.identity);
    expect(localStorage.length).toBe(before);
  });
});

describe("gcWindowPrefs consults liveness", () => {
  it("keeps a LIVE window's blob older than retention; evicts a dead one", async () => {
    const now = Date.now();
    localStorage.setItem(PREFIX + "me", "{}");
    localStorage.setItem(PREFIX + "idle-open", "{}");
    localStorage.setItem(PREFIX + "closed", "{}");
    localStorage.setItem(
      INDEX,
      JSON.stringify({ "idle-open": now - 40 * DAY, closed: now - 40 * DAY }),
    );
    const { gcWindowPrefs } = await import("@/hooks/useViewPrefs");
    gcWindowPrefs("me", new Set(["me", "idle-open"]), now);

    expect(localStorage.getItem(PREFIX + "idle-open")).toBe("{}");
    expect(localStorage.getItem(PREFIX + "closed")).toBeNull();
    const index = JSON.parse(localStorage.getItem(INDEX)!);
    expect(index["idle-open"]).toBe(now);
    expect(index.closed).toBeUndefined();
  });

  it("stamps the CLAIMED id, so a twin's blob is indexed, not adopted on grace", async () => {
    sessionStorage.setItem(ID_KEY, "source");
    localStorage.setItem(PREFIX + "source", '{"a":1}');
    await openWindow();
    const twin = await openWindow();
    const { id } = twin.startup.identity;
    twin.prefs.adoptInheritedWindowPrefs(twin.startup.identity);
    twin.prefs.gcWindowPrefs(id, twin.startup.live);

    const index = JSON.parse(localStorage.getItem(INDEX)!);
    expect(typeof index[id]).toBe("number");
    expect(typeof index.source).toBe("number"); // the source is live too

    // Long after — the twin still open, never reloaded: still kept.
    const later = Date.now() + 40 * DAY;
    twin.prefs.gcWindowPrefs("source", new Set(["source", id]), later);
    expect(localStorage.getItem(PREFIX + id)).toBe('{"a":1}');
  });
});
