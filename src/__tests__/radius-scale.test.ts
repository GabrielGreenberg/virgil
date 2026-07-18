import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

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

/**
 * Guard REACH (task 2026-07-18-169).
 *
 * The guard used to branch on the file EXTENSION — `.css` got the kebab-case
 * scan, everything else got the camelCase one — so a kebab `border-radius`
 * inside a `.tsx` `style.cssText` string was invisible to it, and six
 * untokenized drag-ghost radii shipped that way. These cases pin the reach of
 * each declaration form on a planted `.tsx` fixture, so the extension branch
 * can't grow back.
 */
describe("radius-token guard reach", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "virgil-radius-guard-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Run the guard against one planted fixture; return its violation report. */
  function scan(source: string): { ok: boolean; report: string } {
    const fixture = path.join(dir, "fixture.tsx");
    writeFileSync(fixture, source, "utf8");
    try {
      execFileSync("node", ["scripts/check-radius-tokens.mjs", fixture], {
        cwd: ROOT,
        stdio: "pipe",
      });
      return { ok: true, report: "" };
    } catch (err) {
      const e = err as { stderr?: Buffer; stdout?: Buffer };
      return { ok: false, report: String(e.stderr ?? "") + String(e.stdout ?? "") };
    }
  }

  it.each([
    // The class that shipped: CSS syntax living inside a .tsx string.
    ["kebab radius in a cssText string", `el.style.cssText = "padding:4px;border-radius: 7px;";`, "7px"],
    // The `=` assignment form — no colon, so the camelCase `:` regex missed it.
    ["style.borderRadius assignment", `el.style.borderRadius = "7px";`, "7px"],
    // Expression-valued: the old value group needed a quote or a leading digit.
    ["ternary-valued borderRadius", `const s = { borderRadius: hot ? 7 : 0 };`, "7"],
    // The form that always worked — kept so the rewrite can't regress it.
    ["plain inline borderRadius", `const s = { borderRadius: 7 };`, "7"],
    ["arbitrary Tailwind rounded", `<div className="rounded-[7px]" />`, "rounded-[7px]"],
    // A token branch vouches for itself only — it must not immunize the literal
    // beside it, which is exactly the shape a half-finished sweep leaves behind.
    ["a literal beside a token in a ternary", `const s = { borderRadius: big ? "var(--panel-radius)" : "7px" };`, "7px"],
    // A className carries several arbitrary radii; checking only the first misses the rest.
    ["a second rounded-[] on the line", `<div className="rounded-[var(--pod-radius)] rounded-t-[7px]" />`, "rounded-[7px]"],
    // Wrapped by prettier: the value lands on the line after the property name.
    ["a wrapped assignment", `el.style.borderRadius =\n  "7px";`, "7px"],
    ["a wrapped CSS shorthand", "const css = `\n  border-radius:\n    7px 7px 0 0;\n`;", "7px"],
  ])("flags %s", (_label, source, expected) => {
    const { ok, report } = scan(source);
    expect(ok, `guard passed a literal radius in: ${source}`).toBe(false);
    expect(report).toContain(expected);
  });

  it.each([
    ["a token", `el.style.cssText = "border-radius: var(--radius-md);";`],
    ["a token with a fallback", `el.style.borderRadius = "var(--radius-xs,3px)";`],
    ["a token-valued ternary", `const s = { borderRadius: hot ? "var(--pod-radius)" : undefined };`],
    ["a hairline bar", `el.style.cssText = "border-radius: 1px;";`],
    ["a perfect circle", `const s = { borderRadius: "50%" };`],
    // Prose describing CSS: the value stops at the closing brace. The trailing
    // "7px" is what gives this case teeth — without the depth-0 `}` break the
    // value would run on and swallow it, so this fails if that break regresses.
    ["a comment quoting a rule", `// global \`{ border-radius: inherit }\` — was 7px before`],
    // A comparison is a READ, not a declaration; flagging it would break CI on
    // innocent code.
    ["a borderRadius comparison", `if (el.style.borderRadius === "7px") return;`],
    // A token's own fallback literal is legitimate — it IS the token's value.
    ["a token fallback literal", `const s = { borderRadius: "var(--panel-radius, 14px)" };`],
    // A type annotation carries no numeric literal, so it must stay silent.
    ["a type annotation", `type S = { borderRadius?: string };`],
    ["the radius-allow hatch", `const s = { borderRadius: width / 2 }; // radius-allow`],
  ])("passes %s", (_label, source) => {
    const { ok, report } = scan(source);
    expect(ok, `guard flagged a legitimate radius: ${source}\n${report}`).toBe(true);
  });
});
