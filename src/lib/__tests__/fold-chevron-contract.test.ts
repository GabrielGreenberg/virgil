/**
 * Task 830 — the fold chevron is ONE control with two renderers (heading
 * NodeView, source pod). Source-level guards that they share one stylesheet
 * source and one attribute writer, so they cannot drift apart again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { foldChevronAttrs } from "@/lib/fold-chevron";

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const css = read("src/app/globals.css");

/** Every declaration block whose selector list mentions `cls`. */
function blocksFor(cls: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m; (m = re.exec(css)); ) if (m[1].includes(cls)) out.push(m[2]);
  return out;
}

describe("fold-chevron contract (task 830)", () => {
  it("centering derives from the column-width token, never a typed half-width", () => {
    for (const body of blocksFor(".heading-fold-chevron")) {
      expect(body).not.toMatch(/-\s*7px/);
    }
    expect(css).toMatch(
      /\.heading-wrapper-l1 \.heading-fold-chevron\s*\{\s*top:\s*calc\([^;]*var\(--margin-col-chevron-width[^;]*\/ 2\)/,
    );
  });

  it("the shared class owns the common rules; kind classes restate none of them", () => {
    expect(blocksFor(".margin-fold-chevron").join("\n")).toMatch(/transform:\s*rotate\(90deg\)/);
    for (const kind of [".heading-fold-chevron", ".source-pod-fold-chevron"]) {
      for (const body of blocksFor(kind)) {
        for (const prop of ["transform", "color", "cursor", "transition", "stroke-width", "filter", "width"]) {
          expect(body, `${kind} restates ${prop}`).not.toMatch(new RegExp(`(^|[;\\s])${prop}\\s*:`));
        }
      }
    }
  });

  it("both renderers stamp the shared class and read the one attribute writer", () => {
    const heading = read("src/lib/editor-extensions.ts");
    expect(heading).toMatch(/heading-fold-chevron \$\{FOLD_CHEVRON_CLASS\} focus-ring/);
    expect(heading).toMatch(/paintFoldChevron\(foldBtn/);
    expect(heading).not.toMatch(/foldBtn\.title\s*=/);
    expect(read("src/lib/section-folding.ts")).not.toMatch(/btn\.title\s*=/);
    const pod = read("src/components/SourcePodNodeView.tsx");
    expect(pod).toMatch(/source-pod-fold-chevron \$\{FOLD_CHEVRON_CLASS\}/);
    expect(pod).toMatch(/foldChevronAttrs\(collapsed, config\.kindLabel\)/);
  });

  it("aria-expanded describes the controlled content (true when NOT folded)", () => {
    expect(foldChevronAttrs(false, "listing")).toMatchObject({
      "aria-expanded": "true",
      "aria-label": "Collapse listing",
      "data-hint": "Collapse listing",
    });
    expect(foldChevronAttrs(true, "listing")["aria-expanded"]).toBe("false");
  });
});
