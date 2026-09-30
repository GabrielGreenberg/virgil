/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPO_ROOT, commentsStripped } from "@/lib/__tests__/_source-scan";
import {
  FLAG_KEYS,
  FLAG_OFF_VALUES,
  FLAG_ON_VALUES,
  FLAG_REGISTRY,
  clearFlagOverrides,
  flagBootstrapExpr,
  readFlag,
  type FlagKey,
} from "@/lib/feature-flags";
import {
  WCO_DEBUG_PARAM,
  displayModeBootstrapScript,
} from "@/lib/window-chrome-bootstrap";

/**
 * PRE-PAINT FLAG READS AGREE WITH `readFlag` (task 2026-09-29-846).
 *
 * The inline bootstrap in app/layout.tsx read `virgil:wco-debug` as
 * `=== '1'` while `useWindowChrome` read it through `readFlag`, which accepts
 * the whole dialect. With the key set to "true", first paint showed the real
 * display mode and then flipped to window-controls-overlay. The bootstrap now
 * emits its test from the SSOT; this suite evaluates the emitted expression
 * and demands it agree with `readFlag` on every spelling, for every row.
 */

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const evalExpr = (expr: string): unknown => new Function(`return (${expr});`)();

const SPELLINGS: (string | null)[] = [
  null,
  ...FLAG_ON_VALUES,
  ...FLAG_OFF_VALUES,
  ...FLAG_ON_VALUES.map((v) => ` ${v.toUpperCase()} `),
  ...FLAG_OFF_VALUES.map((v) => ` ${v.toUpperCase()} `),
  "",
  "maybe",
  "2",
];

function setAll(keys: readonly FlagKey[], v: string | null): void {
  for (const k of keys) {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  }
}

describe("flagBootstrapExpr — the inline twin of readFlag", () => {
  afterEach(() => {
    clearFlagOverrides();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("agrees with readFlag for every row and every stored spelling", () => {
    for (const key of FLAG_KEYS) {
      const deps = FLAG_REGISTRY[key].requires as readonly FlagKey[];
      for (const v of SPELLINGS) {
        // Parents both satisfied and not, so the `requires` edge is exercised.
        for (const depV of deps.length ? ["1", "0", null] : [null]) {
          localStorage.clear();
          setAll(deps, depV);
          setAll([key], v);
          expect(
            evalExpr(flagBootstrapExpr(key)),
            `${key} = ${JSON.stringify(v)} (deps = ${JSON.stringify(depV)})`,
          ).toBe(readFlag(key));
        }
      }
    }
  });

  it("a throwing localStorage reads as the row's default, like readFlag", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked site data");
    });
    for (const key of FLAG_KEYS) {
      expect(evalExpr(flagBootstrapExpr(key)), key).toBe(readFlag(key));
    }
  });
});

describe("displayModeBootstrapScript", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-display-mode");
  });

  const run = (): string | null => {
    new Function(displayModeBootstrapScript())();
    return document.documentElement.getAttribute("data-display-mode");
  };

  it("enters WCO debug mode on every ON spelling, not only \"1\"", () => {
    for (const v of [...FLAG_ON_VALUES, " True ", "YES"]) {
      localStorage.setItem("virgil:wco-debug", v);
      expect(run(), v).toBe("window-controls-overlay");
    }
  });

  it("stays in the real display mode when the switch is off or unset", () => {
    for (const v of [...FLAG_OFF_VALUES, "maybe"]) {
      localStorage.setItem("virgil:wco-debug", v);
      expect(run(), v).toBe("browser");
    }
    localStorage.clear();
    expect(run()).toBe("browser");
  });

  it("uses the shared query-param constant", () => {
    expect(displayModeBootstrapScript()).toContain(JSON.stringify(WCO_DEBUG_PARAM));
  });

  it("layout.tsx injects the generated script and reads no storage itself", () => {
    const layout = commentsStripped(
      readFileSync(path.join(REPO_ROOT, "src/app/layout.tsx"), "utf8"),
    );
    expect(layout).toMatch(/__html:\s*displayModeBootstrapScript\(\)/);
    expect(layout).not.toMatch(/\b(local|session)Storage\b/);
    expect(layout).not.toMatch(/virgil:/);
  });
});
