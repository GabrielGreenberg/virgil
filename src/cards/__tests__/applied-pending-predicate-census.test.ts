// @vitest-environment node
//
// Task 1499 — CENSUS: "is this an APPLIED PENDING change?" has ONE owner.
//
// Task 1151 gave "is this suggestion RESOLVED?" one rule. Its sibling question
// — a stored suggestion with `status:"applied"` AND an `appliedChange`
// descriptor — was answered by `isAppliedPending` and re-spelled inline by the
// auto-apply serializer, the reload re-stamp, the reapers' alive-set and the
// margin's applied-change link. Four readers deciding the same set means a
// future status (or a change to the `appliedChange` requirement) must be
// remembered four times, and the serializer, the bulk Keep/Revert bar and the
// reload pass could each come to see a different set of pending changes.
//
// Pinned here:
//   1. outside the owner leaf (`src/cards/suggestion-status.ts`), no source
//      compares a status to `"applied"` within reach of an `appliedChange` —
//      call `isAppliedPendingSuggestion`;
//   2. the five-member status union is spelled only in the leaf
//      (`SuggestionStatus`);
//   3. no caller injects the status literals a verb writes (the deleted
//      `appliedStatus`/`staleStatus`/`acceptedStatus`/`rejectedStatus` deps —
//      a parameter whose value was always the same constant).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { codeOnly, REPO_ROOT, walkFiles } from "@/lib/__tests__/_source-scan";

const SRC = path.join(REPO_ROOT, "src");
const OWNER = path.join(SRC, "cards/suggestion-status.ts");

/** Every shipped TS/TSX source under `src/` (tests excluded), code only. */
function sources(): Array<{ rel: string; code: string }> {
  return walkFiles(SRC, { skipDirs: ["__tests__"] })
    .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && p !== OWNER)
    .map((p) => ({
      rel: path.relative(REPO_ROOT, p),
      code: codeOnly(fs.readFileSync(p, "utf8")),
    }));
}

/** How far (chars) an `appliedChange` read may sit from an `"applied"`
 *  comparison and still count as one conjunction. A multi-line `if (` with the
 *  three legs on their own lines spans ~120 chars. */
const REACH = 240;

describe("applied-pending predicate CENSUS (task 1499)", () => {
  const files = sources();

  it("scans a real population", () => {
    expect(files.length).toBeGreaterThan(500);
    // Non-vacuity: the readers that used to spell it inline now call the owner.
    const callers = files
      .filter((f) => /\bisAppliedPendingSuggestion\(/.test(f.code))
      .map((f) => f.rel);
    expect(callers).toEqual(
      expect.arrayContaining([
        "src/hooks/useAutoApplyPendingChanges.ts",
        "src/links/_shared/reapply-pending-marks.ts",
        "src/links/_shared/card-anchor-links.ts",
        "src/links/pending-change-collect.ts",
      ]),
    );
  });

  it('no inline `status === "applied"` paired with `appliedChange` outside the owner', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const re = /status\s*[!=]==?\s*["']applied["']|["']applied["']\s*[!=]==?\s*[\w.?]*status\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.code))) {
        const window = f.code.slice(Math.max(0, m.index - REACH), m.index + REACH);
        if (/\bappliedChange\b/.test(window)) {
          const line = f.code.slice(0, m.index).split("\n").length;
          offenders.push(`${f.rel}:${line}`);
        }
      }
    }
    expect(offenders, "call isAppliedPendingSuggestion (src/cards/suggestion-status.ts)").toEqual([]);
  });

  it("the suggestion status union is spelled only in the leaf", () => {
    const offenders = files
      .filter((f) => /["']pending["']\s*\|\s*["']applied["']\s*\|\s*["']stale["']/.test(f.code))
      .map((f) => f.rel);
    expect(offenders, "use SuggestionStatus from src/cards/suggestion-status.ts").toEqual([]);
  });

  it("no caller injects the status literal a verb writes", () => {
    const offenders = files
      .filter((f) => /\b(?:applied|stale|accepted|rejected)Status\s*:/.test(f.code))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
