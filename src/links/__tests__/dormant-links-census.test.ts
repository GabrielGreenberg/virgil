// CENSUS — the DORMANT state has ONE owner (task 1193).
//
// `archivedWith` (on a Link and on a card) means "this anchor's text is inside
// an archive snippet". Every reader must ask `@/links/dormant` — a second
// spelling of the predicate (a hand-typed `link.archivedWith` test) is exactly
// how one reader would come to disagree with the resolver about what is
// archived and what is orphaned. So production code may NAME the field only in
// the module that owns it and the two type declarations that declare it.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { codeOnly, REPO_ROOT, walkFiles } from "@/lib/__tests__/_source-scan";

const OWNERS = new Set([
  "src/links/dormant.ts",
  "src/links/_shared/types.ts",
  "src/lib/types.ts",
]);

describe("dormant-links CENSUS", () => {
  it("only @/links/dormant reads or writes `archivedWith`", () => {
    const offenders: string[] = [];
    const files = walkFiles(path.join(REPO_ROOT, "src"), {
      skipDirs: ["__tests__"],
    }).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(100);
    for (const abs of files) {
      const rel = path.relative(REPO_ROOT, abs).split(path.sep).join("/");
      if (OWNERS.has(rel)) continue;
      const code = codeOnly(fs.readFileSync(abs, "utf8"));
      if (/\barchivedWith\b/.test(code)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("the owner is real: it reads and writes the field", () => {
    const code = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src/links/dormant.ts"), "utf8"));
    expect(code).toMatch(/\.archivedWith\b/);
    expect(code).toMatch(/delete out\.archivedWith/);
  });
});
