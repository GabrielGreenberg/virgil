/**
 * The single canonical "is this AI request still open?" predicate.
 *
 * This is the **exact mirror** of the Python drain's rule in
 * `editor/scripts/list_requests.py` (`list_ai_requests`, the `status` guards at
 * ~L89-93). Both sides decide whether a row in `ai-requests.json` is still
 * awaiting service, and they MUST agree byte-for-byte — a drifted copy is
 * exactly the bug this module retires (task 2026-07-05-043): the bridge and the
 * drain disagreeing on the `in-progress`+`resultId` state caused re-requests to
 * be silently swallowed and toggle-offs to orphan the proposal's `resultId`.
 *
 * Two clauses, one gate:
 *
 *   1. `complete` / `failed` are the v1 terminal statuses (legacy
 *      `draft` / `submitted` and v1 `pending` / `in-progress`, and a
 *      status-absent row, are otherwise open).
 *   2. An L3 (safetyLevel 3 / propose) responder deliberately leaves its Task
 *      `in-progress` while stamping `resultId` the moment its proposal card
 *      lands (`apply_response.cmd_write`). Once that card exists the USER owns
 *      accept/reject in the editor, so the drain must not re-nag — an
 *      `in-progress` row WITH a non-empty `resultId` is *answered*, not open.
 *
 * `editor/scripts/list_requests.py`'s rule is the cross-language twin; the
 * parity is pinned by `src/lib/__tests__/ai-request-open-parity.test.ts`, which
 * enumerates the `status × resultId` matrix and reads the live Python source so
 * a change on either side trips a test instead of silently re-drifting.
 */

import type { AiRequest } from "@/lib/types";

/**
 * True iff the request is still open to the drain (awaiting service). The
 * argument is narrowed to just the two fields the rule reads so callers can
 * pass any request-shaped object. A non-empty `resultId` counts (matching the
 * Python truthiness check `r.get("resultId")` — empty string is falsy).
 */
export function isRequestOpen(
  r: Pick<AiRequest, "status" | "resultId">,
): boolean {
  if (r.status === "complete" || r.status === "failed") return false;
  if (r.status === "in-progress" && r.resultId) return false;
  return true;
}
