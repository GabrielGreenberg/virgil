// @vitest-environment jsdom
//
// The pending-changes feature flag: default OFF (flag-off MUST preserve
// current behavior so the existing suite stays green), localStorage-readable,
// and test-overridable.
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
  it("defaults OFF", () => {
    expect(isPendingChangesOn()).toBe(false);
  });

  it("reads `1` from localStorage", () => {
    window.localStorage.setItem("virgil:pending-changes", "1");
    expect(isPendingChangesOn()).toBe(true);
  });

  it("any non-`1` localStorage value is OFF", () => {
    window.localStorage.setItem("virgil:pending-changes", "true");
    expect(isPendingChangesOn()).toBe(false);
  });

  it("the test override wins over localStorage (both directions)", () => {
    window.localStorage.setItem("virgil:pending-changes", "1");
    setPendingChangesFlag(false);
    expect(isPendingChangesOn()).toBe(false);
    setPendingChangesFlag(true);
    expect(isPendingChangesOn()).toBe(true);
    setPendingChangesFlag(undefined); // clear → falls back to localStorage
    expect(isPendingChangesOn()).toBe(true);
  });
});
