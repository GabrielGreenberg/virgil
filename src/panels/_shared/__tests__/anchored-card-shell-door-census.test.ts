// CENSUS (task 1656) — `useAnchoredCard` is called through ONE door.
//
// Task 963 made `useAnchoredCardShell` the one door between `useAnchoredCard`
// and the card shell: it owns the pop key + toggle, the hover claim (task
// 1150), the archive-relation row (task 1195), the compressed summary and the
// body-click composition. The orphaned and parked footnote twins were missed
// and hand-rolled the glue — so hovering them published no hover claim and the
// parked one had no pop toggle — and nothing stopped a third card from doing
// the same. A card that has no jump target omits `onJump`; one the float
// system cannot render passes `poppable: false`. Neither needs the raw hook.
//
// A genuine non-card consumer would be listed in ALLOWED with its reason.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT as ROOT, walkFiles } from "@/lib/__tests__/_source-scan";

const ALLOWED: Record<string, string> = {
  "src/panels/_shared/useAnchoredCardShell.ts": "the door itself",
  "src/links/_shared/useAnchoredCard.ts": "the hook's own definition",
};

const SCANNED = walkFiles(join(ROOT, "src"), { skipDirs: ["__tests__"] }).filter((f) =>
  /\.tsx?$/.test(f),
);

/** A CALL, not a mention: `useAnchoredCard(` on a line that is not a comment. */
const CALL = /\buseAnchoredCard\(/;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

describe("anchored card shell door CENSUS (task 1656)", () => {
  it("scans a non-empty population", () => {
    expect(SCANNED.length).toBeGreaterThan(100);
  });

  it("useAnchoredCard is called only from the shell door", () => {
    const offenders: string[] = [];
    for (const file of SCANNED) {
      const rel = relative(ROOT, file);
      if (rel in ALLOWED) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (CALL.test(line) && !COMMENT.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(
      offenders,
      "Route the card through `useAnchoredCardShell` (src/panels/_shared/" +
        "useAnchoredCardShell.ts) and spread its `shell` — omit `onJump` for a " +
        "card with no in-text target, pass `poppable: false` for one the float " +
        "system cannot render. Calling `useAnchoredCard` directly drops the hover " +
        "claim, pop toggle and archive-relation row:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("every allow-listed file still calls the hook (no stale entries)", () => {
    for (const rel of Object.keys(ALLOWED)) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(CALL.test(src), rel).toBe(true);
    }
  });
});
