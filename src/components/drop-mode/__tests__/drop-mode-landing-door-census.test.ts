/**
 * CENSUS (task 1219) — every drop-mode splice exits through the ONE landing
 * door, `src/components/drop-mode/util/mapped-insert.ts`.
 *
 * That file owns both halves of the rule: `insertNodesAdvancing` (advance by
 * what ACTUALLY landed, task 331) and the two exit states — `placeCaretAtLanding`
 * after a whole-node splice (task 482) and `selectInlineRun` after an
 * inline-cursor splice. Stack pull hand-rolled all three again (its private
 * `selectInserted` selected the landed blocks, and its heading branch sized the
 * span by `Σ n.nodeSize`) because nothing pinned the door's callers. This does:
 *
 *   • no `TextSelection.between(` outside the door — a content-spanning
 *     selection is the exit state the next gesture misreads;
 *   • no hand-rolled advancing loop (`content.size - before`) outside the door.
 */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnlyLines, walkFiles } from "@/lib/__tests__/_source-scan";

const ROOT = join(__dirname, "..");
const DOOR = "util/mapped-insert.ts";

const sources = (dir: string) =>
  walkFiles(dir, { skipDirs: ["__tests__"] }).filter((f) => /\.tsx?$/.test(f));

const RULES: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /TextSelection\.between\(/,
    why: "use placeCaretAtLanding (whole-node splice) or selectInlineRun (inline splice) from util/mapped-insert.ts",
  },
  {
    pattern: /content\.size\s*-\s*before/,
    why: "advance through insertNodesAdvancing from util/mapped-insert.ts",
  },
];

describe("drop-mode landing door CENSUS (task 1219)", () => {
  it("only util/mapped-insert.ts writes a spanning selection or advances a splice cursor", () => {
    const files = sources(ROOT);
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (rel === DOOR) continue;
      // Line-aligned code view: a comment NAMING the old arithmetic is not a hit.
      const lines = codeOnlyLines(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        for (const { pattern, why } of RULES) {
          if (pattern.test(line)) offenders.push(`${rel}:${i + 1} — ${why}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the door itself still owns both exits (the census subject is not vacuous)", () => {
    const door = readFileSync(join(ROOT, DOOR), "utf8");
    expect(door).toMatch(/export function placeCaretAtLanding\(/);
    expect(door).toMatch(/export function selectInlineRun\(/);
    expect(door).toMatch(/content\.size - before/);
  });
});
