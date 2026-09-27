import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnlyLines, REPO_ROOT, trackedFiles } from "@/lib/__tests__/_source-scan";

/**
 * DETACHED HOST-METHOD CENSUS (task 2026-09-27-805).
 *
 * A browser's timer / scheduling verbs are RECEIVER-CHECKED: calling one with
 * `this` other than the window (or undefined) throws `TypeError: Illegal
 * invocation`. Node's and jsdom's are not — so a reference detached into an
 * object or variable (`{ setTimeout: globalThis.setTimeout }`, `const raf =
 * window.requestAnimationFrame`) and later invoked as a METHOD passes every
 * suite and throws in every real browser. That shape shipped in
 * `view-lifetime.ts` for ~10 releases and froze every heading-label,
 * paragraph-title and expex label field (the lifetime's first frame threw).
 *
 * The behavioural guard for the lifetime itself lives in
 * `view-lifetime.test.ts` (receiver-checking stubs). This census closes the
 * class for the rest of the app: no shipped source may store one of these
 * host verbs by bare reference. Wrap it (`(cb, ms) => globalThis.setTimeout(cb,
 * ms)`) or `.bind(globalThis)` it.
 */

const VERBS = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "queueMicrotask",
  "fetch",
] as const;

// `: globalThis.setTimeout,` / `= window.fetch;` — a host verb read as a VALUE
// (assigned or stored as a property), not called and not bound.
const DETACHED = new RegExp(
  String.raw`[:=]\s*(?:globalThis|window|self)\.(?:${VERBS.join("|")})\s*(?:[,;})\]]|$)`,
);

describe("detached host-method census", () => {
  it("no shipped source stores a receiver-checked host verb by bare reference", () => {
    const hits: string[] = [];
    for (const abs of trackedFiles("src", /\.(ts|tsx)$/)) {
      const rel = path.relative(REPO_ROOT, abs);
      if (/(^|\/)__tests__\/|\.test\.tsx?$/.test(rel)) continue;
      const lines = codeOnlyLines(readFileSync(abs, "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (DETACHED.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("the needle catches the shape that shipped in view-lifetime.ts", () => {
    expect(DETACHED.test("    setTimeout: globalThis.setTimeout,")).toBe(true);
    expect(DETACHED.test("const raf = window.requestAnimationFrame;")).toBe(true);
    expect(DETACHED.test("    setTimeout: ((cb, ms) => globalThis.setTimeout(cb, ms)),")).toBe(false);
    expect(DETACHED.test("const raf = window.requestAnimationFrame.bind(window);")).toBe(false);
  });
});
