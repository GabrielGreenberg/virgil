// @vitest-environment jsdom
/**
 * Task 830 — the fold chevron is ONE control with two renderers (heading
 * NodeView, source pod). Source-level guards that they share one stylesheet
 * source and one attribute writer, so they cannot drift apart again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { foldChevronAttrs, FOLD_CHEVRON_GLYPH } from "@/lib/fold-chevron";

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const css = read("src/app/globals.css");

/** Every innermost `selector { body }` pair, found in ONE linear pass. (A
 *  global `/([^{}]+)\{([^{}]*)\}/g` regex re-scans every run that precedes
 *  a nested `{` from each of its characters — quadratic over the ~300 KB
 *  stylesheet, which timed this suite out on CI and blocked v0.1.151.) */
const BLOCKS: Array<[selector: string, body: string]> = (() => {
  const out: Array<[string, string]> = [];
  const parts = css.split(/([{}])/); // segment, delim, segment, delim, …
  for (let i = 0; i + 3 < parts.length; i += 2) {
    if (parts[i] && parts[i + 1] === "{" && parts[i + 3] === "}") {
      out.push([parts[i], parts[i + 2]]);
      i += 2; // the body is consumed; the next selector follows the "}"
    }
  }
  return out;
})();

/** Every declaration block whose selector list mentions `cls`. */
function blocksFor(cls: string): string[] {
  return BLOCKS.filter(([sel]) => sel.includes(cls)).map(([, body]) => body);
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
      "aria-label": "Listing",
      "data-hint": "Collapse listing",
    });
    expect(foldChevronAttrs(true, "listing")["aria-expanded"]).toBe("false");
  });

  it("the accessible NAME is stable across states; only the hint names the action (task 1610)", () => {
    const open = foldChevronAttrs(false, "section");
    const shut = foldChevronAttrs(true, "section");
    expect(open["aria-label"]).toBe(shut["aria-label"]);
    expect(open["aria-label"]).not.toMatch(/expand|collapse/i);
    expect(open["data-hint"]).toBe("Collapse section");
    expect(shut["data-hint"]).toBe("Expand section");
  });

  it("the glyph is declared once and every renderer reads it (task 1260)", () => {
    const glyphPath = FOLD_CHEVRON_GLYPH.path;
    const renderers = [
      "src/lib/editor-extensions.ts",
      "src/components/SourcePodNodeView.tsx",
      "src/panels/Outline/OutlinePanel.tsx",
      "src/components/icons/FoldChevronGlyph.tsx",
    ];
    for (const f of renderers) expect(read(f), `${f} re-spells the glyph path`).not.toContain(glyphPath);
    expect(read("src/lib/fold-chevron.ts").split(glyphPath)).toHaveLength(2);
    expect(read("src/lib/editor-extensions.ts")).toMatch(/foldBtn\.appendChild\(buildFoldChevronSvg\(\)\)/);
    expect(read("src/components/SourcePodNodeView.tsx")).toMatch(/<FoldChevronGlyph \/>/);
    expect(read("src/panels/Outline/OutlinePanel.tsx").match(/<FoldChevronGlyph\b/g)).toHaveLength(2);
  });

  it("vanilla builder and React glyph emit the same svg", async () => {
    const { buildFoldChevronSvg } = await import("@/lib/fold-chevron");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { FoldChevronGlyph } = await import("@/components/icons/FoldChevronGlyph");
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(FoldChevronGlyph));
    const fromReact = host.firstElementChild!;
    const fromDom = buildFoldChevronSvg();
    const attrsOf = (el: Element) =>
      Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]));
    expect(attrsOf(fromReact)).toEqual(attrsOf(fromDom));
    expect(fromReact.querySelector("path")!.getAttribute("d")).toBe(FOLD_CHEVRON_GLYPH.path);
    expect(fromDom.querySelector("path")!.getAttribute("d")).toBe(FOLD_CHEVRON_GLYPH.path);
    expect(fromDom.getAttribute("stroke-width")).toBe("1.5");
  });
});
