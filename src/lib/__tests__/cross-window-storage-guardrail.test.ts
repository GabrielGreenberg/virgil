// @vitest-environment jsdom
//
// Cross-window storage guardrail (task 177) — the CI half of the
// storage-event contract, in the same shape as the keystroke-sanctity,
// scroll-reposition, pane-drag and editor-observer guards:
//
//   1. SOURCE-GREP ALLOWLIST — walk `src/` AND `library/` and flag every file
//      that registers a RAW `addEventListener("storage", …)`. The permitted
//      set is exactly ONE file: the primitive itself. Everything else must
//      route through `subscribeToStorageKey`, so the contract's two subtle
//      guards can't be re-derived (and re-broken) per store.
//
//   2. CONTRACT UNIT TESTS — pin those two guards directly, since the whole
//      point of centralizing is that they are stated once.
//
// WHY the contract is subtle enough to deserve a guard: a `storage` handler
// must ignore foreign keys, AND must treat `key === null` as a clear() that
// counts only when `storageArea === localStorage` — a peer's
// `sessionStorage.clear()` fires with a null key too. Before this landed,
// three hand-rolled copies existed and two of them were missing the null-key
// branch entirely.

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { subscribeToStorageKey } from "../cross-window-storage";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../library"); // the Library silo

// ── The permitted raw-listener allowlist ────────────────────────────────────
// The ONE file allowed to touch the native event. A new entry here means a
// store re-implemented the contract instead of consuming it — which is the
// regression this guard exists to catch, so an entry needs a real reason.
const PERMITTED_RAW_STORAGE_LISTENERS: Record<string, string> = {
  "lib/cross-window-storage.ts":
    "The primitive itself — the single encoding of the foreign-key + null-key/storageArea guards.",
};

// Deliberately EMPTY: the Library silo has no cross-window store of its own
// today. Its localStorage helpers (`list-columns`, `row-viewed-store`,
// `library-store`) re-read per call rather than caching a module snapshot. A
// first entry here should consume the primitive, not hand-roll a listener.
const PERMITTED_LIBRARY_RAW_STORAGE_LISTENERS: Record<string, string> = {};

/** A raw registration of the native `storage` event, in either quote style. */
export function detectRawStorageListener(source: string): boolean {
  return /addEventListener\(\s*["']storage["']/.test(source);
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip test + fixture trees so the guard never scans itself.
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      if (entry === "node_modules") continue;
      out.push(...walkSource(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function flagged(root: string): string[] {
  return walkSource(root)
    .filter((f) => detectRawStorageListener(readFileSync(f, "utf8")))
    .map((f) => path.relative(root, f).split(path.sep).join("/"))
    .sort();
}

describe("cross-window storage guardrail — source allowlist", () => {
  it("routes every src/ storage listener through the primitive", () => {
    // If this fails with an EXTRA file: a store hand-rolled its own `storage`
    // listener. Check it handles BOTH guards (foreign keys; `key === null`
    // only from localStorage) — then don't add it here, migrate it to
    // `subscribeToStorageKey`, which is where those guards live.
    expect(flagged(SRC)).toEqual(Object.keys(PERMITTED_RAW_STORAGE_LISTENERS).sort());
  });

  it("keeps the Library silo free of hand-rolled storage listeners", () => {
    expect(flagged(LIBRARY)).toEqual(
      Object.keys(PERMITTED_LIBRARY_RAW_STORAGE_LISTENERS).sort(),
    );
  });

  it("would flag a NEW hand-rolled listener (regression fixture)", () => {
    // The exact shape this guard exists to catch — note the missing null-key
    // branch, which is what two of the three pre-177 copies got wrong.
    const naiveFixture = `
      useEffect(() => {
        const onStorage = (e: StorageEvent) => {
          if (e.key !== MY_KEY) return;
          refresh();
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
      }, []);
    `;
    expect(detectRawStorageListener(naiveFixture)).toBe(true);
    // …and the primitive's own consumers do NOT trip it.
    expect(
      detectRawStorageListener(`const off = subscribeToStorageKey(KEY, refresh);`),
    ).toBe(false);
  });
});

describe("cross-window storage guardrail — the contract itself", () => {
  it("ignores foreign keys", () => {
    const cb = vi.fn();
    const off = subscribeToStorageKey("mine", cb);
    window.dispatchEvent(new StorageEvent("storage", { key: "theirs" }));
    expect(cb).not.toHaveBeenCalled();
    off();
  });

  it("treats key === null as a clear, but only from localStorage", () => {
    const cb = vi.fn();
    const off = subscribeToStorageKey("mine", cb);

    // A peer's sessionStorage.clear() also fires with a null key.
    window.dispatchEvent(
      new StorageEvent("storage", { key: null, storageArea: sessionStorage }),
    );
    expect(cb).not.toHaveBeenCalled();

    // jsdom's constructor accepts only a real Storage for `storageArea`.
    const clearEvent = new StorageEvent("storage", { key: null });
    Object.defineProperty(clearEvent, "storageArea", { value: localStorage });
    window.dispatchEvent(clearEvent);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });
});
