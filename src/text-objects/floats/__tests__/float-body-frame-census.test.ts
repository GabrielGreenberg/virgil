// Task 1346 — every float body renders through ONE frame.
//
// The bodies under `src/text-objects/floats/` used to hand-paste their frame:
// the scroll body's wrapper className (10 sites, drifted into two variants —
// one carrying a `heading-float-body` class no CSS rule read), the sub-editor
// class string (9 sites), the strip order, and linked-range's refusal strip
// (a byte copy of `SourceMissingBanner`'s amber class). `FloatBodyFrame`,
// `FLOAT_PROSE_EDITOR_CLASS` and `FloatStatusStrip` now state each once; this
// CENSUS keeps a body from spelling any of them again.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FLOAT_PROSE_EDITOR_CLASS } from "../float-body-frame";

const FLOATS_DIR = resolve(__dirname, "..");
const SRC_DIR = resolve(__dirname, "../../..");
const FRAME = "float-body-frame.tsx";

const bodies = readdirSync(FLOATS_DIR).filter(
  (f) => f.endsWith(".tsx") && f !== FRAME,
);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") walk(p, out);
    } else if (/\.(tsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("float body frame CENSUS", () => {
  it("found the float bodies", () => {
    expect(bodies.length).toBeGreaterThanOrEqual(10);
  });

  it.each(bodies)("%s spells no frame piece literally", (file) => {
    const src = readFileSync(join(FLOATS_DIR, file), "utf8");
    expect(src, "wrapper className belongs to FloatBodyFrame").not.toMatch(
      /className=\{?[`"][^`"]*par-float-body/,
    );
    expect(src, "use FLOAT_PROSE_EDITOR_CLASS").not.toContain(
      FLOAT_PROSE_EDITOR_CLASS,
    );
    expect(src, "the strips are FloatBodyFrame's to render").not.toMatch(
      /<(SourceMissingBanner|WriteRefusedBanner)\b/,
    );
  });

  it("the dead `heading-float-body` class is gone from the tree", () => {
    const hits = walk(SRC_DIR).filter(
      (p) => !p.endsWith(FRAME) && readFileSync(p, "utf8").includes("heading-float-body"),
    );
    expect(hits).toEqual([]);
  });

  it("the amber standing-strip class is spelled once — in FloatStatusStrip", () => {
    const AMBER = "bg-[var(--surface-warning,";
    const hits = walk(SRC_DIR)
      .filter((p) => readFileSync(p, "utf8").includes(AMBER))
      .map((p) => p.slice(SRC_DIR.length + 1));
    expect(hits).toEqual(["lib/float-sync.tsx"]);
    const sync = readFileSync(join(SRC_DIR, "lib/float-sync.tsx"), "utf8");
    expect(sync.split(AMBER).length - 1).toBe(1);
  });
});
