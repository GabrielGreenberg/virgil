// @vitest-environment jsdom
//
// Dock-stack eviction victim-selection contract (task 251).
//
// `leastRecentlyUsed` picks which docked band closes when a full side opens
// another panel. Recency (`panelMRU`) is SESSION-ONLY: `loadPrefs` restores
// the full `dockStack` on reload but resets the MRU to empty, so the MRU can
// cover only a STRICT SUBSET of the docked panels (partial coverage). A band
// absent from the MRU was never touched this session and is therefore the
// stalest — it must be evicted before any tracked panel.
//
// The bug (pre-fix): with `stack=[A,B,C]`, `mru=[A]` the old loop returned the
// first tracked panel walking the MRU tail→head — i.e. A, the panel the user
// JUST used — while the untouched B and C survived. This suite pins the correct
// victim through the REAL `openPanelDocked` eviction path (not an isolated
// helper), driving the exact reachable post-reload state: seed a persisted
// dockStack, mount (which resets the MRU), then re-seed recency via
// `notePanelUse` before opening a 4th panel on the full side.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
// useViewPrefs transitively pulls `@/lib/storage` (require("@/lib/storage-fsa")
// can't be aliased by vitest — see vitest_extension_barrel_storage_mock memo).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
// The cross-window bus uses BroadcastChannel (absent in jsdom). Stub it — this
// suite exercises the same-window dock engine, not the bus.
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

import { renderHook, act, cleanup } from "@testing-library/react";
import { useViewPrefs } from "../useViewPrefs";

const WINDOW_KEY = `virgil-view-prefs/window/${WINDOW_ID}`;

// Four real, left-dockable PANEL_REGISTRY ids. A=footnotes, B=citations,
// C=reports are the persisted stack (MAX_STACK = 3, so full); D=examples is
// the 4th open that forces an eviction.
const A = "footnotes";
const B = "citations";
const C = "reports";
const D = "examples";

// The project's jsdom env doesn't ship a full Storage; install minimal
// in-memory shims (mirrors view-prefs-registry-roundtrip.test.ts).
function installStorageShim(name: "localStorage" | "sessionStorage") {
  const store = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

/** Persist a full 3-panel left dock stack, then mount the hook. `loadPrefs`
 *  restores the stack and (by design) resets `panelMRU` to empty — the real
 *  post-reload partial-coverage starting state. */
function mountWithStack() {
  localStorage.setItem(
    WINDOW_KEY,
    JSON.stringify({ dockStack: { left: [A, B, C], right: [] } }),
  );
  return renderHook(() => useViewPrefs());
}

describe("useViewPrefs — dock-eviction victim under session-only MRU (task 251)", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it("restores the stack but resets recency on load (partial coverage is reachable)", () => {
    const { result } = mountWithStack();
    expect(result.current.prefs.dockStack.left).toEqual([A, B, C]);
    expect(result.current.prefs.panelMRU.left).toEqual([]); // session-only reset
  });

  it("PARTIAL coverage: never evicts the just-used band; drops the oldest untracked one", () => {
    const { result } = mountWithStack();

    // User touches A this session → MRU=[A]. B and C remain untracked (staler).
    act(() => result.current.notePanelUse("left", A));
    expect(result.current.prefs.panelMRU.left).toEqual([A]);

    // Open D on the full left side → eviction runs.
    act(() => result.current.openPanelDocked(D, "left"));

    // The pre-fix bug evicted A (the just-used panel). Correct: B — the
    // oldest-opened untracked band — closes; A survives.
    expect(result.current.prefs.dockStack.left).toEqual([A, C, D]);
    expect(result.current.prefs.dockStack.left).toContain(A); // just-used kept
    expect(result.current.prefs.dockStack.left).not.toContain(B); // stalest evicted
  });

  it("ZERO coverage: empty MRU evicts the top (oldest-opened) band, unchanged", () => {
    const { result } = mountWithStack();
    // No notePanelUse → MRU stays empty (every band untracked).
    act(() => result.current.openPanelDocked(D, "left"));
    // stack[0] === A is the victim (oldest-opened).
    expect(result.current.prefs.dockStack.left).toEqual([B, C, D]);
  });

  it("FULL coverage: every band tracked → true LRU (MRU tail) is the victim, unchanged", () => {
    const { result } = mountWithStack();
    // Touch all three, oldest→newest, so C is least-recent and A most-recent:
    // MRU=[A, B, C]? bumpMRU prepends, so bump order C,B,A ⇒ mru=[A,B,C].
    act(() => result.current.notePanelUse("left", C));
    act(() => result.current.notePanelUse("left", B));
    act(() => result.current.notePanelUse("left", A));
    expect(result.current.prefs.panelMRU.left).toEqual([A, B, C]);

    act(() => result.current.openPanelDocked(D, "left"));
    // Full coverage → LRU tail = C closes; A (most-recent) and B survive.
    expect(result.current.prefs.dockStack.left).toEqual([A, B, D]);
    expect(result.current.prefs.dockStack.left).not.toContain(C);
  });
});
