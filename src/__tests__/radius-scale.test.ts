import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Radius-scale SSOT contract (task 2026-07-03-013).
 *
 * Corner radii flow from ONE six-step token scale defined in globals.css and
 * mapped onto Tailwind's `rounded-*` namespace. These tests lock:
 *   1. the scale tokens exist with their canonical values,
 *   2. the Tailwind `@theme` mapping aliases `rounded-lg`/`rounded-xl` onto the
 *      canonical --pod-radius/--panel-radius (so print-mode flattening + the
 *      tier SSOT are preserved),
 *   3. the guard passes — no stray literal radii have crept back into the tree.
 */
const ROOT = path.resolve(__dirname, "..", "..");
const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

describe("radius scale tokens", () => {
  it.each([
    ["--radius-xs", "3px"],
    ["--radius-sm", "4px"],
    ["--radius-md", "6px"],
    ["--pod-radius", "8px"],
    ["--panel-radius", "14px"],
    ["--radius-pill", "9999px"],
    ["--library-manila-radius", "10px"],
  ])("defines %s = %s in :root", (token, value) => {
    expect(globals).toMatch(new RegExp(`${token}:\\s*${value.replace(/[.]/g, "\\.")}\\s*;`));
  });

  it("maps the Tailwind radius namespace onto the scale", () => {
    // rounded-lg / rounded-xl must alias the canonical pod/panel tokens, not
    // hard-code 8px/14px — that keeps them print-mode-flattenable + single-sourced.
    expect(globals).toMatch(/--radius-lg:\s*var\(--pod-radius\)/);
    expect(globals).toMatch(/--radius-xl:\s*var\(--panel-radius\)/);
    // xs/sm/md/pill self-reference the :root values (emitted, unlayered-wins).
    expect(globals).toMatch(/--radius-md:\s*var\(--radius-md\)/);
    expect(globals).toMatch(/--radius-pill:\s*var\(--radius-pill\)/);
  });
});

describe("radius-token guard", () => {
  it("finds no stray literal radii in the tree", () => {
    // Throws (non-zero exit) if the guard reports any violation.
    expect(() =>
      execFileSync("node", ["scripts/check-radius-tokens.mjs"], {
        cwd: ROOT,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
