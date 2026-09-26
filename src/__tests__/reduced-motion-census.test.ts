import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type ChildNode, type Declaration } from "postcss";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, strip, trackedFiles } from "@/lib/__tests__/_source-scan";

/** Comments blanked, strings kept (the needles live in class strings), and
 *  LINE-ALIGNED so a hit reports its real `file:line`. */
const scanView = (src: string) => strip(src, true, true);

/**
 * REDUCED MOTION — every MOVEMENT opts in (task 775).
 *
 * The app's rule (STYLE_GUIDE "Motion"): a transition or animation that
 * MOVES something — `transform`, position, size — is written under
 * `@media (prefers-reduced-motion: no-preference)` (or Tailwind's
 * `motion-safe:` variant, which compiles to the same query). There is no
 * global `reduce` reset, so the opt-in is the ONLY thing standing between a
 * reduced-motion user and the motion: forget it and the motion simply plays.
 * Task 775 found the drop bars, the strip drop line and the fold chevrons all
 * gliding unconditionally — the bars on most frames of every drag.
 *
 * Colour and opacity fades are NOT movement and need no opt-in (a hover tint
 * snapping is not a kindness to anyone). A keyframe animation opts in when it
 * moves or LOOPS (a pulse/breathe/ping); a progress spinner (`animate-spin`)
 * is exempt, because it carries state.
 *
 * Legs:
 *  1. CSS — every `transition`/`transition-property`/`animation` declaration
 *     in the two stylesheets that carries movement sits inside the opt-in.
 *  2. Inline — no `.ts`/`.tsx` inline style / cssText transitions movement
 *     (no media query can reach an inline style; use a class).
 *  3. Tailwind — `transition-transform`, `transition-all`, a movement-bearing
 *     `transition-[…]` and `animate-ping|pulse|bounce` carry `motion-safe:`.
 */

const MOVEMENT =
  /^(all|transform|translate|rotate|scale|top|left|right|bottom|inset(-.*)?|width|height|min-width|min-height|max-width|max-height|margin(-.*)?)$/;

const OPT_IN = /prefers-reduced-motion\s*:\s*no-preference/;

const TIME = /^-?[\d.]+m?s$/;

/** Property names a `transition` shorthand / `transition-property` names. A
 *  segment that opens with a time (or is `initial` etc.) transitions `all`. */
function transitionedProps(prop: string, value: string): string[] {
  const v = value.trim();
  if (/^(none|unset|initial|inherit)$/.test(v)) return [];
  return v.split(",").map((seg) => {
    const first = seg.trim().split(/\s+/)[0] ?? "";
    if (prop === "transition-property") return first;
    return TIME.test(first) || first.startsWith("cubic-bezier") ? "all" : first;
  });
}

function insideOptIn(node: ChildNode): boolean {
  for (let p = node.parent; p; p = p.parent as typeof p) {
    if (p.type === "atrule" && (p as AtRule).name === "media" && OPT_IN.test((p as AtRule).params)) {
      return true;
    }
  }
  return false;
}

function selectorOf(node: ChildNode): string {
  const p = node.parent;
  return p && p.type === "rule" ? (p as { selector: string }).selector.replace(/\s+/g, " ") : "?";
}

/** Keyframes that move (animate a movement property) — by name. */
function movingKeyframes(root: postcss.Root): Set<string> {
  const out = new Set<string>();
  root.walkAtRules(/keyframes$/, (at) => {
    at.walkDecls((d) => {
      if (MOVEMENT.test(d.prop)) out.add(at.params.trim());
    });
  });
  return out;
}

function cssViolations(rel: string): string[] {
  const css = readFileSync(path.join(REPO_ROOT, rel), "utf8");
  const root = postcss.parse(css, { from: rel });
  const moving = movingKeyframes(root);
  const hits: string[] = [];
  root.walkDecls((d: Declaration) => {
    if (insideOptIn(d)) return;
    const where = `${rel}:${d.source?.start?.line} ${selectorOf(d)} { ${d.prop}: ${d.value} }`;
    if (d.prop === "transition" || d.prop === "transition-property") {
      if (transitionedProps(d.prop, d.value).some((p) => MOVEMENT.test(p))) hits.push(where);
    } else if (d.prop === "animation" || d.prop === "animation-name") {
      const tokens = d.value.split(/[\s,]+/);
      if (tokens.some((t) => moving.has(t)) || tokens.includes("infinite")) hits.push(where);
    }
  });
  return hits;
}

const STYLESHEETS = ["src/app/globals.css", "library/styles/library.css"];

function sourceFiles(): string[] {
  return ["src", "library"]
    .flatMap((r) => trackedFiles(r, /\.tsx?$/))
    .filter((f) => !/(__tests__|\.test\.tsx?$)/.test(f));
}

/** Tailwind tokens allowed without `motion-safe:`, with the reason. */
const TAILWIND_ALLOW: Record<string, string> = {
  // BUTTON_BASE: `transition-all` is the colour carrier for every Button
  // variant (see the hover-on-light-exempt note there); its only movement is
  // the 0.5px `active:` press nudge — a click response, not a glide.
  "src/components/panel-primitives.tsx|transition-all": "BUTTON_BASE press nudge",
};

const TW_TOKEN =
  /(?<=^|[\s"'`{])((?:[a-z-]+:)*)(transition-transform|transition-all|transition-\[[^\]\s]*\]|animate-(?:ping|pulse|bounce))(?=$|[\s"'`}])/gm;

function tailwindViolations(abs: string, src: string): string[] {
  const rel = path.relative(REPO_ROOT, abs);
  const hits: string[] = [];
  for (const m of src.matchAll(TW_TOKEN)) {
    const [, variants, token] = m;
    if (variants.split(":").includes("motion-safe")) continue;
    if (token.startsWith("transition-[")) {
      const props = token.slice("transition-[".length, -1).split(",");
      if (!props.some((p) => MOVEMENT.test(p))) continue;
    }
    if (TAILWIND_ALLOW[`${rel}|${token}`]) continue;
    const line = src.slice(0, m.index).split("\n").length;
    hits.push(`${rel}:${line} ${variants}${token}`);
  }
  return hits;
}

/** A style-object key, a `.style.transition =` write, or a `cssText`
 *  declaration: the value runs to the closing quote, `;` or end of line. */
const INLINE = /\btransition\s*[:=]\s*[`"']?([^;`"'\n]*)/g;

function inlineViolations(abs: string, src: string): string[] {
  const rel = path.relative(REPO_ROOT, abs);
  const hits: string[] = [];
  for (const m of src.matchAll(INLINE)) {
    const value = m[1].replace(/\$\{[^}]*\}/g, "0ms");
    if (transitionedProps("transition", value).some((p) => MOVEMENT.test(p))) {
      const line = src.slice(0, m.index).split("\n").length;
      hits.push(`${rel}:${line} transition: ${value.trim()}`);
    }
  }
  return hits;
}

describe("reduced motion — every movement opts in (task 775)", () => {
  it("transitionedProps reads the shorthand the way CSS does", () => {
    expect(transitionedProps("transition", "color 0.15s, transform 0.15s ease")).toEqual([
      "color",
      "transform",
    ]);
    expect(transitionedProps("transition", "0.2s ease")).toEqual(["all"]);
    expect(transitionedProps("transition", "none")).toEqual([]);
  });

  it("the CSS leg bites: a bare transform transition is caught, the opted-in one is not", () => {
    const root = postcss.parse(
      `.a { transition: transform 1s; }
       @media (prefers-reduced-motion: no-preference) { .b { transition: top 1s; } }
       .c { transition: opacity 1s; }`,
    );
    const bad: string[] = [];
    root.walkDecls((d) => {
      if (!insideOptIn(d) && transitionedProps(d.prop, d.value).some((p) => MOVEMENT.test(p))) {
        bad.push(selectorOf(d));
      }
    });
    expect(bad).toEqual([".a"]);
  });

  it("the Tailwind leg bites", () => {
    const fake = path.join(REPO_ROOT, "src/x.tsx");
    expect(
      tailwindViolations(
        fake,
        `<i className="transition-transform motion-safe:transition-all transition-[opacity] transition-[width] animate-spin animate-pulse" />`,
      ),
    ).toEqual(["src/x.tsx:1 transition-transform", "src/x.tsx:1 transition-[width]", "src/x.tsx:1 animate-pulse"]);
  });

  it("the inline leg bites (style object and cssText)", () => {
    const fake = path.join(REPO_ROOT, "src/x.ts");
    expect(inlineViolations(fake, `const s = { transition: "opacity 1s" };`)).toEqual([]);
    expect(inlineViolations(fake, `const s = { transition: "transform 1s" };`)).toHaveLength(1);
    expect(
      inlineViolations(fake, "el.style.cssText = `\n  will-change: transform; transition: transform 0.1s ease;\n`;"),
    ).toHaveLength(1);
  });

  it.each(STYLESHEETS)("%s: no movement outside the opt-in", (rel) => {
    expect(cssViolations(rel)).toEqual([]);
  });

  it("no inline-style transition carries movement", () => {
    const hits = sourceFiles().flatMap((f) => inlineViolations(f, scanView(readFileSync(f, "utf8"))));
    expect(hits).toEqual([]);
  });

  it("every movement-bearing Tailwind transition/loop rides motion-safe:", () => {
    const hits = sourceFiles().flatMap((f) => tailwindViolations(f, scanView(readFileSync(f, "utf8"))));
    expect(hits).toEqual([]);
  });

  it("the allowlist is live (each entry still names a real token)", () => {
    for (const key of Object.keys(TAILWIND_ALLOW)) {
      const [rel, token] = key.split("|");
      expect(readFileSync(path.join(REPO_ROOT, rel), "utf8")).toContain(token);
    }
  });
});
