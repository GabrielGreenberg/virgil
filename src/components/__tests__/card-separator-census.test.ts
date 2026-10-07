// Task 969 census: the card section separator (STYLE_GUIDE "Selection") has
// ONE spelling — `CardSeparator` in panel-primitives.tsx. A card body that
// hand-rolls the `border-edge-subtle group-hover:border-edge-hover` rule next
// to `separatorSelected` re-opens the "two selection authorities for one look"
// drift (it keyed on the host's `isSelected` while PanelCard keyed on the halo).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { walkFiles } from "../../lib/__tests__/_source-scan";

const SRC = join(__dirname, "..", "..");
const PRIMITIVE = "components/panel-primitives.tsx";

function walk(dir: string): string[] {
  return walkFiles(dir, { skipDirs: ["__tests__"] }).filter((p) => /\.(tsx?|jsx?)$/.test(p));
}

describe("card separator census (task 969)", () => {
  it("only CardSeparator pairs the rest rule with separatorSelected", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split("\\").join("/");
      const text = readFileSync(file, "utf8");
      if (!text.includes("separatorSelected")) continue;
      if (!text.includes("border-edge-subtle group-hover:border-edge-hover")) continue;
      if (rel === PRIMITIVE) {
        // the primitive itself spells it exactly once
        const n = text.split("borderTopColor: theme.separatorSelected").length - 1;
        if (n !== 1) offenders.push(`${rel} (spells it ${n}×; expected 1, in CardSeparator)`);
        continue;
      }
      offenders.push(rel);
    }
    expect(offenders, `Render <CardSeparator selected={halo} theme={theme} /> instead`).toEqual([]);
  });

  it("the primitive is read: PanelCard and the card bodies render CardSeparator", () => {
    const prim = readFileSync(join(SRC, PRIMITIVE), "utf8");
    expect(prim).toMatch(/<CardSeparator selected=\{selected\}/);
    for (const rel of ["panels/Examples/ExampleCard.tsx", "panels/Citations/CitationCard.tsx"]) {
      const t = readFileSync(join(SRC, rel), "utf8");
      expect(t, rel).toMatch(/<CardSeparator selected=\{isHaloed\}/);
    }
  });
});
