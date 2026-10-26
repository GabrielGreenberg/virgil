/**
 * PROPOSAL FINALIZE — the ONE rule for "an AI proposal reached a terminal
 * status; end the Task it answers" (task 1043).
 *
 * An L3 responder answers a request with a PROPOSAL — a revision- or
 * cutter-suggestion card stamped `aiOriginRequestId` (the card→Task
 * back-pointer) — and leaves the Task `in-progress` + `resultId` ("answered-L3":
 * closed to the drain, waiting on the user). The proposal has two finishers:
 *
 *   - SCRIPT side — `/editor/accept-suggestion` / `reject-suggestion` →
 *     `apply_response.py` `cmd_accept` / `cmd_reject`, which complete the Task
 *     (`result: accepted|rejected`) and, on accept, close the todo it answered.
 *   - APP side — the user's ordinary path: Accept / Reject (flag-OFF), Keep /
 *     Dismiss / Insert-below (flag-ON), the stale card's Dismiss, the lifecycle
 *     SETTLE. Every one of them ends in the family hook's
 *     `setSuggestionStatus(id, "accepted"|"rejected")`.
 *
 * So the app's seam is not any of those verbs — it is the STATUS TRANSITION
 * they share. `withProposalFinalize` wraps the hook's `setSuggestionStatus`
 * once, at the hook's construction in `EditorPane`, so every present and future
 * caller finalizes without knowing it must; a sixth verb cannot forget.
 *
 * KEYSTROKE SANCTITY: fires only on an explicit status commit (a click / a
 * settle), never per transaction.
 */

import { CARD_REGISTRY } from "@/cards/card-registry";
import { isResolvedSuggestion, isResolvedSuggestionStatus } from "@/cards/suggestion-status";
import {
  finalizeProposalRequest,
  type ProposalFinalizeCause,
  type ProposalResult,
} from "@/lib/ai-request-bridge";
import type { AiRequestLink } from "@/lib/types";

/**
 * Does `prev → next` END a proposal, and how? `accepted` / `rejected` are the
 * terminal outcomes; every other status (`pending`, `applied`, `stale`) is a
 * stage on the way. A transition INTO a terminal state from a non-terminal one
 * finalizes; re-setting the same terminal state, or a terminal → terminal flip,
 * does not (the Task was already finalized by the first one — the Python side
 * refuses the opposite flip outright).
 */
export function proposalFinalizeResult(
  prev: string | undefined,
  next: string,
): ProposalResult | null {
  if (!isResolvedSuggestionStatus(next)) return null;
  if (isResolvedSuggestionStatus(prev)) return null;
  return next;
}

/** The Task a proposal card answers, or null (a human-authored suggestion). */
export function proposalOriginRequestId(card: unknown): string | null {
  if (!card || typeof card !== "object") return null;
  const id = (card as { aiOriginRequestId?: unknown }).aiOriginRequestId;
  return typeof id === "string" && id ? id : null;
}

/**
 * THE LEAVE RULE (task 1046) — a proposal can also END by being REMOVED: a
 * delete, an archive, or a morph out of the suggestion kind. None of those is a
 * status transition, so `withProposalFinalize` never sees them, and the Task
 * the proposal answers was left `in-progress` + `resultId` forever — the same
 * stranded row 1043 fixed for Accept/Reject, by the other way a proposal ends.
 *
 * So the rule is stated about the CARD, not the verb: a suggestion carrying
 * `aiOriginRequestId` that leaves while still NON-terminal ends its Task with
 * `LEAVING_PROPOSAL_RESULT` ("rejected" — the user set the proposal aside
 * without taking it; the ask is still unanswered, so the source todo stays
 * open). A proposal already accepted/rejected finalized its Task when it got
 * there, so leaving writes nothing. Returns the Task id, or null.
 *
 * The leave close is PROVISIONAL (task 1062): the row is stamped
 * `closedBy: "leave"`, so if the proposal comes back (an Archive restore keeps
 * its `aiOriginRequestId`) and is then accepted, the ordinary finalize
 * overwrites it — `accepted`, todo closed — on either door, never a silent
 * no-op on a row that "already ended".
 *
 * Read by BOTH app doors — the lifecycle executor's delete/morph legs
 * (`finalizeLeavingProposal` dep, wired in EditorPane) and the archive toggle —
 * and mirrored script-side by `apply_response.py` `_leaving_proposal_origin`
 * (cmd_archive). `stored kind === "suggestion"` is the same family test
 * `withProposalFinalize` makes.
 */
export const LEAVING_PROPOSAL_RESULT: ProposalResult = "rejected";

export function leavingProposalRequestId(card: unknown): string | null {
  if (!card || typeof card !== "object") return null;
  const c = card as { kind?: unknown; status?: unknown };
  if (c.kind !== "suggestion") return null;
  if (isResolvedSuggestion(c)) return null;
  return proposalOriginRequestId(card);
}

/** Apply the leave rule to `card`: when it is a non-terminal AI proposal, hand
 *  its Task to `onFinalize` with `LEAVING_PROPOSAL_RESULT`. */
export function finalizeLeavingProposal(
  card: unknown,
  onFinalize: ProposalFinalizeFn,
): void {
  const requestId = leavingProposalRequestId(card);
  if (requestId) onFinalize(requestId, LEAVING_PROPOSAL_RESULT, "left");
}

/** The finalize callback both halves of the rule feed: `cause` is `"settled"`
 *  for an accept/reject, `"left"` for the leave rule. */
export type ProposalFinalizeFn = (
  requestId: string,
  result: ProposalResult,
  cause: ProposalFinalizeCause,
) => void;

/**
 * The SOURCE closure: which todo (if any) does finalizing with `result` close?
 * Only an ACCEPT closes — the ask was answered. A REJECT leaves the todo open:
 * the ask is still unanswered, and re-opening the Task instead would re-run the
 * AI unasked. The todo panel's wire token is read from the registry, never
 * spelled here. Mirrors `cmd_accept`'s `close_source_todo` leg.
 */
export function todoClosedByFinalize(
  link: AiRequestLink | null,
  result: ProposalResult,
): string | null {
  if (result !== "accepted" || !link) return null;
  const todoPanel = CARD_REGISTRY.todo.aiRequest?.linkPanel;
  return todoPanel && link.panel === todoPanel && link.cardId ? link.cardId : null;
}

/**
 * Finalize the Task `requestId` with `result`, then close the source todo it
 * answered (accept only). `closeTodo` is the todo hook's idempotent `setDone`.
 */
export async function finalizeProposal(
  docId: string | null,
  requestId: string,
  result: ProposalResult,
  closeTodo: (todoId: string) => void,
  cause: ProposalFinalizeCause = "settled",
): Promise<void> {
  const link = await finalizeProposalRequest(docId, requestId, result, cause);
  const todoId = todoClosedByFinalize(link, result);
  if (todoId) closeTodo(todoId);
}

/** The slice of a suggestion family hook (`useRevisions` / `useCutter`) the
 *  wrapper reads and replaces. `status` is typed `never` so ANY family's
 *  status union is assignable (parameter contravariance); the wrapper hands the
 *  caller's value straight back to the family's own setter. */
export interface ProposalStatusHook {
  cards: readonly unknown[];
  /** The live collection (task 1295); preferred over `cards` when present. */
  getCards?: () => readonly unknown[];
  setSuggestionStatus: (id: string, status: never) => void;
}

/**
 * Return `hook` with its `setSuggestionStatus` finalizing on a terminal
 * transition. The PREVIOUS status is read from the LIVE collection
 * (`hook.getCards()`, task 1295; `hook.cards` for a hook without one), so a
 * second transition issued before React re-renders sees the first's status
 * rather than finalizing twice; a double fire would be harmless anyway —
 * `finalizeProposalRequest` writes nothing over an already-terminal row and
 * `setDone` is idempotent.
 */
export function withProposalFinalize<H extends ProposalStatusHook>(
  hook: H,
  onFinalize: ProposalFinalizeFn,
): H {
  const inner = hook.setSuggestionStatus as (id: string, status: string) => void;
  const setSuggestionStatus = (id: string, status: string) => {
    const card = (hook.getCards?.() ?? hook.cards).find(
      (c) =>
        !!c &&
        typeof c === "object" &&
        (c as { id?: unknown }).id === id &&
        (c as { kind?: unknown }).kind === "suggestion",
    ) as { status?: string } | undefined;
    inner(id, status);
    if (!card) return;
    const result = proposalFinalizeResult(card.status, status);
    const requestId = result && proposalOriginRequestId(card);
    if (result && requestId) onFinalize(requestId, result, "settled");
  };
  return { ...hook, setSuggestionStatus: setSuggestionStatus as H["setSuggestionStatus"] };
}
