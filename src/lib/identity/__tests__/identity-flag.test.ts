// @vitest-environment jsdom
//
// The identity-cascade feature flag: default OFF (flag-off MUST preserve
// current behavior so the existing suite stays green), localStorage-readable,
// and test-overridable.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { isIdentityCascadeOn, setIdentityCascadeFlag } from "../identity-flag";

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
  setIdentityCascadeFlag(undefined);
  window.localStorage.removeItem("virgil:identity-cascade");
});

describe("identity-cascade flag", () => {
  it("defaults OFF", () => {
    expect(isIdentityCascadeOn()).toBe(false);
  });

  it("reads `1` from localStorage", () => {
    window.localStorage.setItem("virgil:identity-cascade", "1");
    expect(isIdentityCascadeOn()).toBe(true);
  });

  // Task 646 replaced the per-flag dialect with one universal vocabulary
  // (`1|true|on|yes` / `0|false|off|no`), so `"true"` now means what whoever
  // typed it meant. `"1"` — this flag's documented sentinel — is unchanged, so
  // no switch already set changed meaning; the dialect only ADDED spellings.
  it("the whole ON vocabulary reads ON, not just `1`", () => {
    for (const v of ["1", "true", "on", "yes"]) {
      window.localStorage.setItem("virgil:identity-cascade", v);
      expect(isIdentityCascadeOn(), v).toBe(true);
    }
  });

  it("a value outside the vocabulary falls back to the default (OFF)", () => {
    window.localStorage.setItem("virgil:identity-cascade", "maybe");
    expect(isIdentityCascadeOn()).toBe(false);
  });

  it("the test override wins over localStorage (both directions)", () => {
    window.localStorage.setItem("virgil:identity-cascade", "1");
    setIdentityCascadeFlag(false);
    expect(isIdentityCascadeOn()).toBe(false);
    setIdentityCascadeFlag(true);
    expect(isIdentityCascadeOn()).toBe(true);
    setIdentityCascadeFlag(undefined); // clear → falls back to localStorage
    expect(isIdentityCascadeOn()).toBe(true);
  });
});
