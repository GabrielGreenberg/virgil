/**
 * Cross-language parity pin for the "is this AI request open?" predicate
 * (task 2026-07-05-043).
 *
 * The decision lives in TWO languages that must agree byte-for-byte:
 *
 *   - TS: `isRequestOpen` (`src/lib/ai-request-open.ts`) — the SSOT the bridge
 *     (`ai-request-bridge.ts`) and the migration (`migrate-ai-request-cards.ts`)
 *     both call.
 *   - Python: `list_ai_requests` (`editor/scripts/list_requests.py`) — the drain
 *     the external skills read.
 *
 * They silently drifted once already (the drain grew the
 * `in-progress`+`resultId ⇒ answered` clause; the bridge's copy didn't), which
 * is the bug this test exists to forbid. It pins parity two ways:
 *
 *   1. **Matrix** — enumerate every `status × {resultId set / unset}` cell and
 *      assert `isRequestOpen` matches a byte-for-byte transcription of the
 *      Python rule.
 *   2. **Source pin** — read the live `list_requests.py` and assert its two
 *      guard clauses are still present verbatim, so a Python-side edit forces a
 *      human to re-verify the transcription (mirrors how
 *      `ai-request-routing-manifest.test.ts` reads the drain-consumed manifest).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isRequestOpen } from "@/lib/ai-request-open";
import type { AiRequest, AiRequestStatus } from "@/lib/types";

/** Byte-for-byte transcription of the Python drain rule
 *  (`list_requests.py` `list_ai_requests`):
 *
 *    status = r.get("status")
 *    if status in ("complete", "failed"):
 *        continue
 *    if status == "in-progress" and r.get("resultId"):
 *        continue
 *    # else: open
 *
 *  `undefined` models a status-absent row (`r.get("status")` → None). */
function drainOpenReference(
  status: AiRequestStatus | undefined,
  hasResultId: boolean,
): boolean {
  if (status === "complete" || status === "failed") return false;
  if (status === "in-progress" && hasResultId) return false;
  return true;
}

/** Every `status` value the on-disk schema can carry, plus the absent case. */
const STATUSES: (AiRequestStatus | undefined)[] = [
  "pending",
  "in-progress",
  "complete",
  "failed",
  "draft",
  "submitted",
  undefined,
];

describe("isRequestOpen ↔ list_requests.py drain rule parity", () => {
  it("agrees with the drain rule across the status × resultId matrix", () => {
    for (const status of STATUSES) {
      for (const hasResultId of [false, true]) {
        const r = {
          status,
          ...(hasResultId ? { resultId: "card-x" } : {}),
        } as Pick<AiRequest, "status" | "resultId">;
        expect(isRequestOpen(r)).toBe(drainOpenReference(status, hasResultId));
      }
    }
  });

  it("classifies the answered-L3 cell (in-progress + resultId) as CLOSED", () => {
    // The one cell the two predicates disagreed on before the fix.
    expect(isRequestOpen({ status: "in-progress", resultId: "card-x" })).toBe(false);
    expect(isRequestOpen({ status: "in-progress" })).toBe(true);
  });

  it("treats an empty-string resultId as falsy (matches Python truthiness)", () => {
    // Python `r.get("resultId")` is falsy for "" — an in-progress row with a
    // blank resultId is still OPEN, same on both sides.
    expect(isRequestOpen({ status: "in-progress", resultId: "" })).toBe(true);
  });

  it("the live drain source still carries the two guard clauses verbatim", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/lib/__tests__ → repo root → editor/scripts/list_requests.py
    const drainPath = join(here, "../../..", "editor/scripts/list_requests.py");
    const src = readFileSync(drainPath, "utf8");
    // Normalize whitespace so indentation changes don't spuriously fail, while
    // the clause structure is pinned. A change to either clause forces whoever
    // edits the Python to re-check `isRequestOpen` + `drainOpenReference` above.
    const collapsed = src.replace(/\s+/g, " ");
    expect(collapsed).toContain('if status in ("complete", "failed"): continue');
    expect(collapsed).toContain('if status == "in-progress" and r.get("resultId"): continue');
  });
});
