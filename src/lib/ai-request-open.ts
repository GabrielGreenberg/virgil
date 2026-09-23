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

import type { AiRequest, AiRequestResult, AiRequestStatus } from "@/lib/types";

/**
 * The terminal-status SSOT: `complete` / `failed` are the v1 terminal
 * statuses. Every "a row is terminal / resolved" decision in the AI-request
 * surface derives from THIS predicate rather than re-inlining the
 * `{ complete, failed }` literal set, so a future terminal `AiRequestStatus`
 * is added in one place:
 *
 *   - `isRequestOpen` (below) — clause 1, the drain's open rule.
 *   - the bridge's `terminate`-mode guard (`ai-request-bridge.ts`
 *     `isLinkedNonTerminal`) — "close EVERY linked NON-terminal row" on
 *     `cmd_archive` (task 253).
 *
 * The Python drain's twin literal (`list_requests.py` `list_ai_requests` and
 * `close_linked_request`) is the cross-language mirror; parity across both
 * TS predicates AND the Python source is pinned by
 * `ai-request-open-parity.test.ts`.
 */
export function isTerminalStatus(s: AiRequestStatus): boolean {
  return s === "complete" || s === "failed";
}

/**
 * CLOSE a row: the ONE spelling of "this request ended", shared by every
 * terminal transition the app owns.
 *
 * Three user actions end a request from a skill's point of view — **delete**
 * the card, **archive** it, **withdraw** the request (untick the "AI request"
 * box, or Cancel it in the AI window). All three are the same event to the
 * out-of-process reader holding the id, so all three write the same shape and
 * differ only in the `result` token that says WHICH ending it was:
 *
 *   - delete / archive → `"auto-applied"` (the card is gone; the bridge's
 *     `"terminate"` mode, the UI twin of Python `close_linked_request(force=True)`).
 *   - withdraw        → `"withdrawn"` (the card stays; the user retracted the ask).
 *
 * Withdrawal used to be spelled as an ERASURE instead — the toggle-off leg
 * filtered the row out of the file and the AI window's cancel deleted it
 * outright — so a skill that had already claimed the id came back to a file
 * with no such row and died on `die("request id not found")` after all its
 * work, exit 2, nothing written and no idempotent-skip branch to land in
 * (task 720). A request the user withdrew is a request that ENDED; the holder
 * of its id must always be able to read what became of it. Nothing that a
 * reader outside this process may be holding is ever removed from the file.
 *
 * Pure, and safe to run over a row that is already terminal — but callers
 * gate first (`isLinkedNonTerminal` / `isRequestOpen`) so an idempotent
 * re-close writes nothing at all.
 */
export function closeRequestRow(
  r: AiRequest,
  result: AiRequestResult,
): AiRequest {
  return { ...r, status: "complete", result };
}

/**
 * True iff the request is still open to the drain (awaiting service). The
 * argument is narrowed to just the two fields the rule reads so callers can
 * pass any request-shaped object. A non-empty `resultId` counts (matching the
 * Python truthiness check `r.get("resultId")` — empty string is falsy).
 */
export function isRequestOpen(
  r: Pick<AiRequest, "status" | "resultId">,
): boolean {
  if (isTerminalStatus(r.status)) return false;
  if (r.status === "in-progress" && r.resultId) return false;
  return true;
}

/**
 * The UI-facing THREE-state view of the same two fields.
 *
 * `isRequestOpen` answers the DRAIN's binary question ("must a skill still
 * serve this row?"). The inbox chrome asks a finer one, because it has three
 * buckets and a user who owes an action in the middle state:
 *
 *   - `"open"`      — awaiting service.
 *   - `"responded"` — Claude has answered but the thread is NOT finished: the
 *     only state that is closed-to-the-drain yet non-terminal, i.e. an L3
 *     proposal (`in-progress` + `resultId`). The user owns accept/reject.
 *   - `"resolved"`  — terminal (`complete` / `failed`).
 *
 * It adds NO rule of its own — it is exactly the two predicates above,
 * composed, so it cannot drift from the drain: `open` is `isRequestOpen`, and
 * the closed side SPLITS on `isTerminalStatus`. Nothing here needs a Python
 * twin, because the drain has no use for the split (both closed states are
 * equally not-its-problem); the parity contract stays the two predicates.
 *
 * Before this existed, the AI window's panel branch wrote `open ? "open" :
 * "resolved"` — folding the middle state onto the terminal one, which is why
 * its "Responded" bucket, header count and palette row were all unreachable
 * (task 628). A three-bucket chrome over a binary predicate is a bucket
 * nothing can fill.
 */
export function requestState(
  r: Pick<AiRequest, "status" | "resultId">,
): "open" | "responded" | "resolved" {
  if (isRequestOpen(r)) return "open";
  return isTerminalStatus(r.status) ? "resolved" : "responded";
}
