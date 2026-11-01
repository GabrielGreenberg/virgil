import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type ChildNode, type Declaration, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, strip, trackedFiles } from "@/lib/__tests__/_source-scan";
import { MOTION_MS } from "@/lib/motion";

/**
 * MOTION TIMING — every duration reads a named rung (task 1413).
 *
 * The rule (STYLE_GUIDE "Motion"): a transition / animation duration is never
 * hand-spelled. The ladder is the `--motion-*` block in globals.css; CSS and
 * inline style strings read `var(--motion-…)`, Tailwind reads
 * `duration-(--motion-…)`, and JS that must agree with a CSS rung reads
 * `MOTION_MS` (src/lib/motion.ts). Before this census the same speed shipped
 * in two units (120ms / 0.12s, 80ms / 0.08s) across ~50 sites with no SSOT —
 * so "make hovers a touch slower" was a fifty-site hunt with no way to know
 * it was finished.
 *
 * (Sibling: reduced-motion-census.test.ts checks WHICH properties move; this
 * one checks the VALUES.)
 *
 * Legs:
 *  1. Pin — the CSS block declares exactly MOTION_MS's rungs, at its values.
 *  2. CSS — no literal time or cubic-bezier in any `transition*` /
 *     `animation*` declaration of the two stylesheets (allowlist below).
 *  3. Inline — no `.ts`/`.tsx` string spells `<property> <time>` or a
 *     cubic-bezier (no `${N}ms` interpolation either).
 *  4. Tailwind — no `duration-150` / `duration-[…]` / `delay-*` /
 *     `ease-[cubic-bezier…]`.
 *  5. Every `var(--motion-…)` / `duration-(--motion-…)` names a declared rung
 *     — Tailwind and CSS are both SILENT about an unknown custom property, so
 *     a typo would quietly drop the transition.
 *
 * Easing keywords (`ease`, `ease-out`) are already names and stay spelled;
 * Tailwind's named `ease-out` utility is its own theme token.
 */

const STYLESHEETS = ["src/app/globals.css", "library/styles/library.css"];
const TOKEN_SHEET = "src/app/globals.css";

/** Declarations that may keep a literal time, with the reason. Key:
 *  `<file>|<selector>|<prop>`. */
const CSS_ALLOW: Record<string, string> = {
  // A slow LOOP (the cowork pen's breathing pulse), not a UI response — it
  // sits far off the response ladder on purpose and has one consumer.
  "src/app/globals.css|.cowork-pen-pulse|animation": "looping breathe keyframe",
};

/** Files whose strings may spell a bezier / time: the ladder's own homes. */
const INLINE_ALLOW_FILES = new Set(["src/lib/motion.ts"]);

const TIME_TOKEN = /(?:^|[\s,(])(-?\d*\.?\d+m?s)\b/;
const BEZIER = /cubic-bezier\s*\(/;

function selectorOf(node: ChildNode): string {
  const p = node.parent;
  return p && p.type === "rule" ? (p as Rule).selector.replace(/\s+/g, " ") : "?";
}

/** Violations in one stylesheet's text (text passed in, for the self-check). */
function cssViolations(rel: string, css: string): string[] {
  const hits: string[] = [];
  postcss.parse(css, { from: rel }).walkDecls(/^(transition|animation)/, (d: Declaration) => {
    if (!TIME_TOKEN.test(d.value) && !BEZIER.test(d.value)) return;
    if (CSS_ALLOW[`${rel}|${selectorOf(d)}|${d.prop}`]) return;
    hits.push(`${rel}:${d.source?.start?.line} ${selectorOf(d)} { ${d.prop}: ${d.value} }`);
  });
  return hits;
}

function declaredRungs(): Map<string, string> {
  const out = new Map<string, string>();
  const css = readFileSync(path.join(REPO_ROOT, TOKEN_SHEET), "utf8");
  postcss.parse(css).walkDecls(/^--motion-/, (d) => {
    if (selectorOf(d) === ":root") out.set(d.prop, d.value.trim());
  });
  return out;
}

function sourceFiles(): string[] {
  return ["src", "library"]
    .flatMap((r) => trackedFiles(r, /\.tsx?$/))
    .filter((f) => !/(__tests__|\.test\.tsx?$)/.test(f));
}

/** Strings kept, comments blanked, line-aligned. */
const scanView = (src: string) => strip(src, true, true);

/** `<transitionable property> <time>` — the shape of a transition segment.
 *  The property list keeps log text ("took 12ms") out of reach. */
const INLINE_SEGMENT =
  /\b(?:all|opacity|transform|translate|scale|rotate|top|left|right|bottom|inset|width|height|color|background(?:-color)?|border(?:-color)?|outline(?:-color)?|box-shadow|filter|fill|stroke|margin|padding)\s+(?:\d*\.?\d+m?s\b|\$\{[^}]*\}m?s\b)/g;

function inlineViolations(rel: string, src: string): string[] {
  if (INLINE_ALLOW_FILES.has(rel)) return [];
  const hits: string[] = [];
  const at = (i: number) => src.slice(0, i).split("\n").length;
  for (const m of src.matchAll(INLINE_SEGMENT)) hits.push(`${rel}:${at(m.index)} ${m[0]}`);
  for (const m of src.matchAll(/cubic-bezier\s*\(/g)) hits.push(`${rel}:${at(m.index)} cubic-bezier(`);
  return hits;
}

const TW_LITERAL =
  /(?<=^|[\s"'`{:])((?:duration|delay)-(?:\d+|\[[^\]\s]*\])|ease-\[cubic-bezier[^\]\s]*\])(?=$|[\s"'`}])/gm;

function tailwindViolations(rel: string, src: string): string[] {
  const hits: string[] = [];
  for (const m of src.matchAll(TW_LITERAL)) {
    hits.push(`${rel}:${src.slice(0, m.index).split("\n").length} ${m[1]}`);
  }
  return hits;
}

const RUNG_READ = /(?:var\(|duration-\(|delay-\()(--motion-[a-z-]+)/g;

describe("motion timing census (task 1413)", () => {
  it("the CSS ladder declares exactly MOTION_MS's rungs, at its values", () => {
    const rungs = declaredRungs();
    const cssMs = [...rungs]
      .filter(([k]) => !k.startsWith("--motion-ease-"))
      .map(([k, v]) => [k.slice("--motion-".length), v] as const);
    expect(Object.fromEntries(cssMs)).toEqual(
      Object.fromEntries(Object.entries(MOTION_MS).map(([k, ms]) => [k, `${ms}ms`])),
    );
  });

  it.each(STYLESHEETS)("%s: no hand-spelled duration or bezier", (rel) => {
    const css = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    expect(cssViolations(rel, css)).toEqual([]);
  });

  it("no .ts/.tsx string spells a transition time or bezier", () => {
    const hits = sourceFiles().flatMap((f) =>
      inlineViolations(path.relative(REPO_ROOT, f), scanView(readFileSync(f, "utf8"))),
    );
    expect(hits).toEqual([]);
  });

  it("no Tailwind literal duration / delay / bezier", () => {
    const hits = sourceFiles().flatMap((f) =>
      tailwindViolations(path.relative(REPO_ROOT, f), scanView(readFileSync(f, "utf8"))),
    );
    expect(hits).toEqual([]);
  });

  it("every --motion-* read names a declared rung", () => {
    const declared = declaredRungs();
    const files = [
      ...STYLESHEETS.map((r) => path.join(REPO_ROOT, r)),
      ...sourceFiles(),
    ];
    const unknown: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(RUNG_READ)) {
        if (!declared.has(m[1])) unknown.push(`${path.relative(REPO_ROOT, f)} ${m[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("every allowlist key still names a live declaration", () => {
    const stale = Object.keys(CSS_ALLOW).filter((key) => {
      const [rel, sel, prop] = key.split("|");
      let found = false;
      postcss
        .parse(readFileSync(path.join(REPO_ROOT, rel), "utf8"))
        .walkDecls(prop, (d) => {
          if (selectorOf(d) === sel && TIME_TOKEN.test(d.value)) found = true;
        });
      return !found;
    });
    expect(stale).toEqual([]);
  });

  describe("self-check: each leg fires on a planted stray", () => {
    it("CSS", () => {
      expect(cssViolations("x.css", ".a { transition: opacity 0.2s; }")).toHaveLength(1);
      expect(cssViolations("x.css", ".a { animation: f 1s cubic-bezier(0,0,1,1); }")).toHaveLength(1);
      expect(cssViolations("x.css", ".a { transition: opacity var(--motion-fast) ease; }")).toEqual([]);
    });
    it("inline", () => {
      expect(inlineViolations("x.tsx", `const s = { transition: "opacity 200ms ease" };`)).toHaveLength(1);
      expect(inlineViolations("x.tsx", "const s = `opacity ${MS}ms ease`;")).toHaveLength(1);
      expect(inlineViolations("x.tsx", `log("took 12ms");`)).toEqual([]);
    });
    it("Tailwind", () => {
      expect(tailwindViolations("x.tsx", `<i className="transition-opacity duration-150" />`)).toHaveLength(1);
      expect(tailwindViolations("x.tsx", `<i className="motion-safe:duration-[120ms]" />`)).toHaveLength(1);
      expect(tailwindViolations("x.tsx", `<i className="duration-(--motion-base)" />`)).toEqual([]);
    });
  });
});
