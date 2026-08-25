import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { commentsStripped, cssCommentsStripped, trackedFiles } from "@/lib/__tests__/_source-scan";

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

  it("maps the BARE `rounded` key onto the tier it already rendered at", () => {
    // `--radius` (no suffix) is what the bare `rounded` utility reads. Tailwind's
    // default is 0.25rem = 4px, which is --radius-sm — so mapping it there is
    // provably byte-neutral on screen while moving ~200 corners onto a tier the
    // app owns. Assert the VALUE, don't assume it (task 2026-08-25-458).
    expect(globals).toMatch(/--radius:\s*var\(--radius-sm\)\s*;/);
    expect(globals).toMatch(/--radius-sm:\s*4px\s*;/);
  });

  it.each(["2xl", "3xl", "4xl"])(
    "clears the unowned --radius-%s tier rather than inheriting a vendor value",
    (tier) => {
      // `@theme` MERGES into Tailwind's default theme; `initial` is v4's only
      // way to remove a key. A tier the app has no token for must be
      // unrepresentable, not silently 1/1.5/2rem.
      expect(globals).toMatch(new RegExp(`--radius-${tier}:\\s*initial\\s*;`));
    },
  );
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

/**
 * NAMESPACE COVERAGE (task 2026-08-25-458).
 *
 * The `@theme` block's job is to back the `rounded-*` utilities with the app's
 * scale — and `@theme` MERGES into Tailwind's default theme, so a rung it does
 * not restate silently keeps a vendor value. That is exactly what happened to
 * the BARE `rounded` utility (theme key `--radius`, ~200 sites): it rendered
 * 4px because Tailwind's default happens to be 4px, not because the app said so.
 *
 * Neither existing guard could see it. `check-radius-tokens.mjs` greps
 * ARBITRARY values (`rounded-[…]`) — a NAMED utility is not a literal, so it is
 * invisible by construction. The mapping assertions above ask that the six
 * declared tokens exist — never whether the declared set COVERS the spellings
 * the tree actually uses.
 *
 * So this is the leg that catches the ORIGINAL shape: the mapping was never the
 * part that could misbehave, a spelling outside it is. Membership is
 * DISCOVERED from what the repo ships (the guard's own scan dirs + extensions),
 * so a new spelling is covered by being written. Allowlist EMPTY — a hit is
 * MAP-it (give the tier a token) or SPELL-it-differently.
 */
describe("rounded-* namespace coverage", () => {
  /** Tailwind v4's `rounded` side/corner segments. Deliberately an explicit set
   *  and not a character class: `[tbrxysel]{1,2}` — the shape the arbitrary-value
   *  guard uses, where it is harmless — would read `rounded-xl`'s `xl` as a side
   *  and mis-resolve the tier. */
  const SIDES = new Set(["s", "e", "t", "r", "b", "l", "ss", "se", "es", "ee", "tl", "tr", "br", "bl"]);
  /** `none` / `full` are `staticValues` in v4, not theme keys — no `@theme`
   *  entry can reach them, and 50-odd sites depend on `rounded-full`. */
  const STATIC = new Set(["none", "full"]);

  /** Every `--radius…` key the app's `@theme` blocks DECLARE, minus any the app
   *  deliberately CLEARS with `initial`. Read from source, so the guard and the
   *  block can never drift. */
  const declared = (() => {
    const keys = new Set<string>();
    for (const m of globals.matchAll(/@theme[^{]*\{([\s\S]*?)\n\}/g)) {
      for (const d of m[1].matchAll(/(--radius[a-z0-9-]*)\s*:\s*([^;]+);/g)) {
        if (d[2].trim() === "initial") keys.delete(d[1]);
        else keys.add(d[1]);
      }
    }
    return keys;
  })();

  /** Resolve one `rounded…` class token to the theme key it consumes.
   *  `null` ⇒ a static value, i.e. nothing for `@theme` to own. */
  function themeKeyFor(token: string): string | null {
    const segs = token.split("-").slice(1);
    if (segs.length && SIDES.has(segs[0])) segs.shift();
    if (segs.length === 0) return "--radius";
    if (segs.length === 1 && STATIC.has(segs[0])) return null;
    return `--radius-${segs.join("-")}`;
  }

  /** Every non-arbitrary `rounded…` class token the tree spells, with its site.
   *  Comments are blanked (a `rounded-corner` in prose is not a utility); string
   *  literals are KEPT, since a className IS a literal. */
  const hits = (() => {
    const out: { token: string; where: string }[] = [];
    for (const root of ["src", "library"]) {
      for (const file of trackedFiles(root, /\.(css|ts|tsx)$/)) {
        const raw = readFileSync(file, "utf8");
        const src = file.endsWith(".css") ? cssCommentsStripped(raw) : commentsStripped(raw);
        const rel = path.relative(ROOT, file);
        src.split("\n").forEach((line, i) => {
          for (const m of line.matchAll(/\brounded(?:-[a-z0-9]+)*(?:-\[[^\]\n]*\])?(?![\w-])/g)) {
            if (m[0].endsWith("]")) continue; // arbitrary — check-radius-tokens.mjs owns it
            out.push({ token: m[0], where: `${rel}:${i + 1}` });
          }
        });
      }
    }
    return out;
  })();

  it("sees the tree (swallow self-check)", () => {
    // A stripper bug, a bad needle, or an empty population would make every leg
    // below pass vacuously. Anchor on the two spellings that cannot go away.
    const tokens = new Set(hits.map((h) => h.token));
    expect(tokens.has("rounded")).toBe(true);
    expect(tokens.has("rounded-full")).toBe(true);
    expect(hits.length).toBeGreaterThan(100);
  });

  it("every rounded-* spelling in the tree reads a key the @theme block owns", () => {
    const unmapped = hits
      .filter((h) => {
        const key = themeKeyFor(h.token);
        return key !== null && !declared.has(key);
      })
      .map((h) => `${h.where}  ${h.token} → ${themeKeyFor(h.token)}`);
    expect(
      Array.from(new Set(unmapped)).sort(),
      "a rounded-* utility reads a theme key the app's @theme block does not declare — " +
        "so its value comes from Tailwind's default, invisibly. Map the tier or respell the site.",
    ).toEqual([]);
  });

  it.each([
    ["rounded", "--radius"],
    ["rounded-t", "--radius"],
    ["rounded-md", "--radius-md"],
    ["rounded-tl-lg", "--radius-lg"],
    ["rounded-xl", "--radius-xl"],
    ["rounded-pill", "--radius-pill"],
    ["rounded-full", null],
    ["rounded-none", null],
  ])("resolves %s to %s", (token, key) => {
    // The resolver is the part of this leg that can be silently wrong — `xl`
    // reading as a side, or `lg` as one, moves a real tier without failing.
    expect(themeKeyFor(token)).toBe(key);
  });
});

/**
 * EMITTED-CSS contract (task 2026-08-25-458).
 *
 * Every leg above reads globals.css as TEXT. That is the right shape for "the
 * block declares X", and it is structurally blind to the only question that
 * matters at the end: what does Tailwind actually EMIT? `@theme` merges rather
 * than replaces, `initial` is v4's remove verb, and `none`/`full` are
 * `staticValues` outside the theme entirely — three vendor behaviours the
 * source text cannot vouch for. So this drives Tailwind's own compiler over the
 * REAL stylesheet and reads the utilities back.
 *
 * The leg with teeth is the byte-neutrality EQUALITY: `rounded` and
 * `rounded-sm` must emit the same declaration. Pre-fix, `rounded` emitted the
 * literal `0.25rem` (Tailwind's default) while `rounded-sm` emitted
 * `var(--radius-sm)` — the same 4px on screen, from two different authorities,
 * which is exactly the invisible coupling this task retires.
 *
 * ~100ms. If a Tailwind bump changes this API, that is a thing worth being
 * told about at the one place the app depends on it.
 */
describe("emitted rounded-* CSS", () => {
  const emitted = (async () => {
    const { compile } = await import("tailwindcss");
    const appDir = path.join(ROOT, "src/app");
    const compiler = await compile(readFileSync(path.join(appDir, "globals.css"), "utf8"), {
      base: appDir,
      loadStylesheet: async (id: string, base: string) => {
        const file = id.startsWith(".")
          ? path.resolve(base, id)
          : path.join(ROOT, "node_modules", id === "tailwindcss" ? "tailwindcss/index.css" : id);
        return { path: file, base: path.dirname(file), content: readFileSync(file, "utf8") };
      },
      loadModule: async () => {
        throw new Error("radius-scale probe: globals.css grew a JS plugin import");
      },
    });
    // The cleared tiers are CONSTRUCTED rather than spelled, so this probe does
    // not itself trip the coverage census above. That is not a dodge: Tailwind's
    // own scanner is literal too, so a class name assembled at runtime is
    // already invisible to the build — the census and the compiler share one
    // blind spot, which is the alignment you want.
    const css = compiler.build([
      "rounded", "rounded-t", "rounded-xs", "rounded-sm", "rounded-md", "rounded-lg",
      "rounded-xl", "rounded-pill", "rounded-full", "rounded-none",
      ...["2xl", "3xl", "4xl"].map((t) => `rounded-${t}`),
    ]);
    /** The declaration body Tailwind emitted for one class, or null. */
    return (cls: string): string | null => {
      const m = css.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`));
      return m ? m[1].replace(/\s+/g, " ").trim() : null;
    };
  })();

  it("emits the bare `rounded` utility identically to `rounded-sm`", async () => {
    const at = await emitted;
    // Byte-neutrality as an EQUALITY, not as two independent regexes: whatever
    // the sm tier is, the bare spelling must be exactly it.
    expect(at("rounded")).toBe(at("rounded-sm"));
    expect(at("rounded")).toBe("border-radius: var(--radius-sm);");
    // The side variants ride the same key, so they move together.
    expect(at("rounded-t")).toContain("var(--radius-sm)");
  });

  it.each(["xs", "sm", "md", "lg", "xl", "pill"])(
    "emits rounded-%s from a token, never a literal",
    async (tier) => {
      const at = await emitted;
      expect(at(`rounded-${tier}`), `rounded-${tier} was not emitted at all`).not.toBeNull();
      expect(at(`rounded-${tier}`)).toMatch(/var\(--/);
    },
  );

  it.each(["2xl", "3xl", "4xl"])("does not emit rounded-%s at all", async (tier) => {
    const at = await emitted;
    // `initial` removes the key, so the utility has no value to resolve and
    // Tailwind emits nothing. Silent — which is why the coverage leg above is
    // what turns a use of it into a build failure.
    expect(at(`rounded-${tier}`)).toBeNull();
  });

  it("still emits the two static values the theme cannot reach", async () => {
    const at = await emitted;
    // `none` / `full` are staticValues in v4, so no `@theme` edit — including
    // an `initial` sweep of the namespace — can take them away. 50-odd sites
    // depend on rounded-full.
    expect(at("rounded-none")).toBe("border-radius: 0;");
    expect(at("rounded-full")).toContain("infinity");
  });
});
