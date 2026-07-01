// @vitest-environment jsdom
//
// The pending-changes feature flag: default ON (graduated), OPT-OUT via the
// `"0"` sentinel (which preserves the legacy accept-immediately path),
// localStorage-readable, and test-overridable.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { isPendingChangesOn, setPendingChangesFlag } from "../pending-changes-flag";

// The project's jsdom env doesn't ship a full localStorage; install a minimal
// in-memory shim so we can exercise the storage-read path (production reads the
// real Storage; the flag code guards reads in try/catch either way).
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});

afterEach(() => {
  setPendingChangesFlag(undefined);
  window.localStorage.removeItem("virgil:pending-changes");
});

describe("pending-changes flag", () => {
  it("defaults ON (unset)", () => {
    expect(isPendingChangesOn()).toBe(true);
  });

  it("opts out with the `0` sentinel", () => {
    window.localStorage.setItem("virgil:pending-changes", "0");
    expect(isPendingChangesOn()).toBe(false);
  });

  it("any non-`0` localStorage value is ON", () => {
    window.localStorage.setItem("virgil:pending-changes", "true");
    expect(isPendingChangesOn()).toBe(true);
    window.localStorage.setItem("virgil:pending-changes", "1");
    expect(isPendingChangesOn()).toBe(true);
  });

  it("the test override wins over localStorage (both directions)", () => {
    window.localStorage.setItem("virgil:pending-changes", "0");
    setPendingChangesFlag(true);
    expect(isPendingChangesOn()).toBe(true);
    setPendingChangesFlag(false);
    expect(isPendingChangesOn()).toBe(false);
    setPendingChangesFlag(undefined); // clear → falls back to localStorage ("0" → off)
    expect(isPendingChangesOn()).toBe(false);
  });
});
