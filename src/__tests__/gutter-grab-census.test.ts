import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  commentsStripped,
  cssCommentsStripped,
  elementSubtree,
  tagsContaining,
  trackedFiles,
} from "@/lib/__tests__/_source-scan";
import { GAP_WIDTH_PX } from "@/components/editor-layout/split-with-code";
import { LIB_GRID_GUTTER } from "../../library/components/library-grid-template";

/**
 * A resize gutter's GRAB has ONE owner (task 1241).
 *
 * Hit area ≠ painted band: a gutter paints at its own thickness but grabs at
 * no less than `--gutter-grab`. Before this, the grab was spelled per site —
 * an inline React hit-target child on three horizontal handles (one pinned,
 * two not), a `::before` on two vertical variants, NOTHING on the code
 * splitter or the three Library resizers — so the same gesture offered 18px
 * in the editor and 6px in the Library, and nothing noticed when a site lost
 * its extension. This census pins the one spelling: the token, read by the
 * `.drag-gap-{h,v}.band-grip::before` rule set, reached by every gutter.
 */
const ROOT = path.resolve(__dirname, "..", "..");
const globals = cssCommentsStripped(
  readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8"),
);

function tokenPx(name: string): number {
  const m = globals.match(new RegExp(`${name}\\s*:\\s*([0-9.]+)px\\s*;`));
  if (!m) throw new Error(`token ${name} not found as a px value`);
  return parseFloat(m[1]);
}
const GRAB = tokenPx("--gutter-grab");

/** Every rule whose selector list contains `selector` exactly → its body. */
function ruleBody(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodies = [
    ...globals.matchAll(new RegExp(`(?<=^|[},])\\s*${esc}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, "g")),
  ].map((m) => m[1]);
  return bodies.join("\n");
}

/** Evaluate one inset value against a painted thickness `p` (px). Only the
 *  shapes the grab rule is allowed to use are understood; anything else
 *  throws, so a hand-written pixel literal cannot slip past as "0". */
function inset(value: string, p: number): number {
  const v = value.trim();
  if (v === "0" || v === "0px") return 0;
  if (!v.includes("var(--gutter-grab)")) {
    throw new Error(`grab inset \`${v}\` does not read --gutter-grab`);
  }
  const js = v
    .replace(/var\(--gutter-grab\)/g, String(GRAB))
    .replace(/100%/g, String(p))
    .replace(/\b0px\b/g, "0")
    .replace(/\bcalc\(/g, "(")
    .replace(/\bmin\(/g, "Math.min(");
  if (!/^[\d\s.+\-*/(),Mathmin]+$/.test(js)) throw new Error(`unparsed inset ${v}`);
  return Function(`return (${js});`)() as number;
}

/** The grab's extent across a gutter painted `p` px thick, for one rule
 *  (merged with its orientation's base rule). `near`/`far` are the two
 *  inset properties across the gutter's thin axis. */
function grabAcross(
  orientation: "h" | "v",
  modifier: "" | ".drag-gap-grab-end" | ".drag-gap-grab-start",
  p: number,
): { near: number; far: number; total: number } {
  const [nearProp, farProp] = orientation === "h" ? ["top", "bottom"] : ["left", "right"];
  const read = (sel: string, prop: string) =>
    new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+);`).exec(ruleBody(sel))?.[1];
  const base = `.drag-gap-${orientation}.band-grip::before`;
  const mod = `.drag-gap-${orientation}.band-grip${modifier}::before`;
  const nearV = (modifier && read(mod, nearProp)) || read(base, nearProp);
  const farV = (modifier && read(mod, farProp)) || read(base, farProp);
  expect(nearV, `${mod} has no ${nearProp}`).toBeDefined();
  expect(farV, `${mod} has no ${farProp}`).toBeDefined();
  // `|| 0` folds the -0 a negated zero inset yields.
  const near = -inset(nearV!, p) || 0;
  const far = -inset(farV!, p) || 0;
  return { near, far, total: p + near + far };
}

describe("gutter grab — the token is a FLOOR over every painted thickness", () => {
  const painted = {
    "--pod-gap": tokenPx("--pod-gap"),
    "--pod-seam": tokenPx("--pod-seam"),
    LIB_GRID_GUTTER,
    GAP_WIDTH_PX,
  };

  it.each(Object.entries(painted))("--gutter-grab ≥ %s (%dpx)", (_n, px) => {
    expect(GRAB).toBeGreaterThanOrEqual(px);
  });

  it.each(
    (["h", "v"] as const).flatMap((o) =>
      (["", ".drag-gap-grab-end", ".drag-gap-grab-start"] as const).flatMap((m) =>
        Object.values(painted).map((p) => [o, m || "(symmetric)", p] as const),
      ),
    ),
  )("drag-gap-%s %s at %dpx painted grabs exactly the token", (o, m, p) => {
    const g = grabAcross(o, m === "(symmetric)" ? "" : m, p);
    expect(g.total).toBe(Math.max(p, GRAB));
    if (m === ".drag-gap-grab-end") expect(g.near).toBe(0);
    if (m === ".drag-gap-grab-start") expect(g.far).toBe(0);
    if (m === "(symmetric)") expect(g.near).toBe(g.far);
  });

  it("every inset on a .drag-gap ::before reads the token (no pixel literal)", () => {
    const re = /(\.drag-gap[^{}]*::before)[^{}]*\{([^}]*)\}/g;
    const offenders: string[] = [];
    for (const m of globals.matchAll(re)) {
      for (const d of m[2].matchAll(/\b(top|bottom|left|right):\s*([^;]+);/g)) {
        try {
          inset(d[2], 10);
        } catch {
          offenders.push(`${m[1].trim()} { ${d[1]}: ${d[2]} }`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("gutter grab — CENSUS: every gutter reaches the shared rule, none re-spells it", () => {
  const files = [
    ...trackedFiles("src", /\.tsx$/),
    ...trackedFiles("library", /\.tsx$/),
  ].filter((f) => !/__tests__/.test(f));
  const gutters = files.flatMap((f) => {
    const src = commentsStripped(readFileSync(f, "utf8"));
    return tagsContaining(src, /className=\{?["`][^"`]*\bdrag-gap\b/).map((tag) => ({
      file: path.relative(ROOT, f),
      tag,
      subtree: elementSubtree(src, tag),
    }));
  });

  it("finds the population (a scan that finds nothing proves nothing)", () => {
    // BandDivider, BottomEdgeHandle, PanelColumn gutter, split-editor panes,
    // code splitter, the three Library resizers.
    expect(gutters.length).toBeGreaterThanOrEqual(8);
  });

  it("every .drag-gap carries band-grip, so the grab rule reaches it", () => {
    const bare = gutters.filter((g) => !/\bband-grip\b/.test(g.tag));
    expect(bare.map((g) => `${g.file}: ${g.tag.slice(0, 90)}`)).toEqual([]);
  });

  it("no gutter hosts its own hit-target child (the grab is the rule's, not the site's)", () => {
    const respelled = gutters.filter(
      (g) =>
        g.subtree !== null &&
        (/cursor-(?:row|col)-resize/.test(g.subtree) ||
          /\b(?:top|bottom|left|right):\s*-\d/.test(g.subtree)),
    );
    expect(respelled.map((g) => g.file)).toEqual([]);
  });

  it("the bottom seam's grab hangs wholly below it (the pod above eats any upward reach)", () => {
    const seam = gutters.find((g) => g.file.endsWith("panel-column.tsx") && /drag-gap-h/.test(g.tag));
    expect(seam, "BottomEdgeHandle's gutter not found").toBeDefined();
    expect(seam!.tag).toMatch(/\bdrag-gap-grab-end\b/);
  });
});
