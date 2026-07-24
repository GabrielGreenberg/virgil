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
import { isRequestOpen, isTerminalStatus } from "@/lib/ai-request-open";
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

/** Every non-absent `status` value the on-disk schema can carry, as a
 *  compile-time-exhaustive tuple: the `satisfies` clause forces this list to
 *  grow whenever a new member is added to `AiRequestStatus`, so a new terminal
 *  status can't be introduced without a human touching the terminal-set pin
 *  below. */
const CONCRETE_STATUSES = [
  "pending",
  "in-progress",
  "complete",
  "failed",
  "draft",
  "submitted",
] as const satisfies readonly AiRequestStatus[];

// Exhaustiveness guard: if `AiRequestStatus` grows a member, this line fails to
// compile until it is added to CONCRETE_STATUSES (and thus enters the matrix +
// terminal-set assertions). `never` iff the two sets are equal.
type _StatusExhaustive = Exclude<
  AiRequestStatus,
  (typeof CONCRETE_STATUSES)[number]
> extends never
  ? true
  : ["AiRequestStatus grew a member — add it to CONCRETE_STATUSES"];
const _statusExhaustive: _StatusExhaustive = true;
void _statusExhaustive;

/** Every `status` value the on-disk schema can carry, plus the absent case. */
const STATUSES: (AiRequestStatus | undefined)[] = [...CONCRETE_STATUSES, undefined];

/** The terminal-status reference set — the `{ complete, failed }` vocabulary
 *  the drain and the bridge both resolve through `isTerminalStatus`. Kept as an
 *  independent literal here so a drift between the helper and the frozen set
 *  (e.g. someone widens `isTerminalStatus` without updating the drain rule)
 *  trips this test. */
const TERMINAL_REFERENCE = new Set<AiRequestStatus>(["complete", "failed"]);

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

/**
 * Terminal-status SSOT pin (task 2026-07-23-221).
 *
 * `isTerminalStatus` is the shared `{ complete, failed }` predicate that BOTH
 * `isRequestOpen` (clause 1) and the bridge's `terminate`-mode guard
 * (`ai-request-bridge.ts` — the `cmd_archive` "close first non-terminal linked
 * row" `findIndex`) now derive from, retiring the two hand-inlined copies. These
 * pins ensure a future terminal `AiRequestStatus` trips a test on BOTH
 * predicates, not just the open one: the exhaustiveness guard above forces the
 * new member into the matrix, and the coupling assertion forces it to agree with
 * `isRequestOpen`.
 */
describe("isTerminalStatus terminal-set SSOT", () => {
  it("matches the frozen { complete, failed } set across the full status matrix", () => {
    for (const status of CONCRETE_STATUSES) {
      expect(isTerminalStatus(status)).toBe(TERMINAL_REFERENCE.has(status));
    }
  });

  it("is coupled to isRequestOpen: every terminal status is CLOSED to the drain", () => {
    // This is the invariant the bridge's `terminate` guard leans on — a row it
    // treats as terminal (`!isTerminalStatus`) is exactly one `isRequestOpen`
    // treats as closed. If a new terminal status were added to `isTerminalStatus`
    // but `isRequestOpen`'s clause 1 stopped reading it, this fails.
    for (const status of CONCRETE_STATUSES) {
      if (isTerminalStatus(status)) {
        // resultId is irrelevant for a terminal row — closed either way.
        expect(isRequestOpen({ status })).toBe(false);
        expect(isRequestOpen({ status, resultId: "card-x" })).toBe(false);
      }
    }
  });

  it("agrees with the drain's terminal literal (the Python { complete, failed })", () => {
    // The same `("complete", "failed")` set the drain source-pin above asserts
    // verbatim — proving the TS terminal SSOT and the Python drain rule share one
    // terminal vocabulary.
    for (const status of CONCRETE_STATUSES) {
      const pythonTerminal = status === "complete" || status === "failed";
      expect(isTerminalStatus(status)).toBe(pythonTerminal);
    }
  });
});
