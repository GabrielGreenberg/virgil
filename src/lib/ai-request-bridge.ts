/**
 * Bridges card-level `aiRequest: boolean` flags into the unified
 * `ai-requests.json` queue.
 *
 * The editor has two parallel signals for "the user wants Claude to act on
 * this":
 *
 *   1. Per-card sticky flags on notes / highlights / todos / cutter-comments /
 *      revision-comments / report-requests / footnotes (BUG #55). Each lives in
 *      its panel sidecar (footnotes in `footnotes.json` via FootnoteRef.aiRequest).
 *   2. The unified `ai-requests.json` queue (drafted, submitted, complete).
 *
 * Skills run from outside the app and need a single inbox they can drain.
 * This module collapses (1) into (2): when a card flag toggles on, we add
 * a corresponding entry with `linkedTo` set; when it toggles off, we drop
 * it. The fulfillment skill clears the card flag *and* flips the request
 * to `complete` when it finishes.
 */

import { generateEntityId } from "@/lib/uuid";
import type { AiRequest, AiRequestLink } from "@/lib/types";
import {
  isAiRequestsWriteRefused,
  mutateAiRequests,
} from "@/lib/ai-requests-store";
import { recordSidecarRefusal } from "@/lib/sidecar-refusal";
import { isRequestOpen, isTerminalStatus } from "@/lib/ai-request-open";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";

/**
 * A request that `terminate` mode must close: it's linked to `link`'s card AND
 * not yet terminal. States the terminate-match rule ONCE (task 253) so every
 * matching row is closed, never just the first. The terminal half is the shared
 * `isTerminalStatus` SSOT — the same source `isRequestOpen` reads for its clause
 * 1, so a future terminal `AiRequestStatus` lands in both predicates at once
 * (task 221). A card can legitimately carry TWO non-terminal linked rows — a
 * closed-to-the-drain answered-L3 (`in-progress`+`resultId`) plus a fresh
 * re-toggled `pending` row (task 043) — and archive/delete means the card is
 * gone, so BOTH must close.
 */
function isLinkedNonTerminal(r: AiRequest, link: AiRequestLink): boolean {
  return (
    !!r.linkedTo &&
    r.linkedTo.panel === link.panel &&
    r.linkedTo.cardId === link.cardId &&
    !isTerminalStatus(r.status)
  );
}

export interface BridgeContext {
  /** Plain text excerpt of the card body — surfaces in the request as `text`. */
  text: string;
  /** Paragraph UUIDs the source card is anchored to. */
  paragraphIds?: string[];
  /** Mode B selectedText snapshot, if any. */
  selectedText?: string;
}

/**
 * How the bridge should reconcile a card's linked `ai-requests.json` row.
 *
 * - `"toggle"` — the reversible per-card flag semantics: `value=true`
 *   adds/refreshes an OPEN row, `value=false` drops it. Deliberately protects an
 *   answered-L3 row (`in-progress`+`resultId`) from a stray toggle-off (task 043).
 * - `"terminate"` — the card is **gone** (archived / deleted), or has left its
 *   aiRequest identity (a flag-dropping morph). A terminal transition: close
 *   EVERY linked NON-terminal row (each a plain open row OR an answered-L3 row)
 *   to `complete` regardless of current openness — a card can carry two at once
 *   (task 253). The UI twin of the Python `close_linked_request(force=True)` on
 *   `cmd_archive` (task 093).
 *
 * THERE IS NO DEFAULT, DELIBERATELY (task 313). `mode` used to default to
 * `"toggle"`, which read as a harmless convenience and was in fact the reason a
 * real bug stayed silent: the morph leg's unbridge callback was written
 * `(kind, cardId) => bridgeCardAiRequestFlag(docId, kind, cardId, false, ctx)`
 * — the terminal transition simply never mentioned a mode, inherited the
 * reversible one, and left answered-L3 rows live forever. An omitted mode is
 * never a safe guess here, because the two clients want opposite fail-safes: a
 * checkbox must PRESERVE an answered row, a card that is going away must CLOSE
 * it. So every writer states which it is, and forgetting is a compile error
 * rather than a silent vote for reversibility.
 */
export type AiRequestSyncMode = "toggle" | "terminate";

/**
 * Sync a card-level `aiRequest` flag toggle into `ai-requests.json`.
 *
 * - `value=true` and no existing linked request → add one (`status: "pending"`).
 * - `value=true` and an existing linked request → leave it (idempotent).
 * - `value=false` and an existing linked request → drop it.
 *
 * Routing is REGISTRY-DECLARED (R29): the request `kind` and the
 * `linkedTo.panel` wire token both come from `CARD_REGISTRY[kind].aiRequest`
 * — the per-call-site panel/kind literals (and the old local panel→kind
 * fan-out table) are gone. The emitted tokens are byte-identical to the
 * legacy literals (pinned by `ai-request-routing-contract.test.ts`), so the
 * idempotent open-request match keeps finding existing on-disk requests.
 *
 * Best-effort: errors are logged, not thrown. The card flag is the source
 * of truth for the panel UI; a stale `ai-requests.json` will self-heal on
 * the next toggle or skill drain.
 *
 * PERSISTENCE (task 220): the whole read-modify-write runs as ONE mutation
 * through `mutateAiRequests`, so the list it merges over is read INSIDE the
 * serialized write critical section. It used to `readSidecar` first and
 * `writeSidecar` after — a base read outside the queue and the cross-window
 * doc lock, which a concurrent writer could invalidate between the two halves.
 * Everything below the mutator boundary is therefore PURE (see
 * `AiRequestsMutator`): the request object and its id/timestamp are built
 * BEFORE the mutation so re-running it over a different base is stable.
 */
export async function bridgeCardAiRequestFlag(
  docId: string | null,
  cardKind: CardKind,
  cardId: string,
  value: boolean,
  ctx: BridgeContext,
  // REQUIRED — see `AiRequestSyncMode`. The former `= "toggle"` default is what
  // made task 313's stranded answered-L3 rows invisible.
  mode: AiRequestSyncMode,
): Promise<void> {
  if (!docId) return;
  const routing = CARD_REGISTRY[cardKind].aiRequest;
  if (!routing) {
    // A kind with no declared routing has no aiRequest flag to bridge —
    // reaching here is a caller bug; make it loud in dev, no-op in prod.
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[ai-request-bridge] card kind "${cardKind}" declares no aiRequest ` +
          `routing on CARD_REGISTRY; flag toggle ignored.`,
      );
    }
    return;
  }
  const link: AiRequestLink = { panel: routing.linkPanel, cardId };

  // The NEW row this call would file, minted BEFORE the mutation so the mutator
  // stays pure (`AiRequestsMutator`): re-running it over a different base must
  // not mint a second id or a second timestamp. Unused on every branch that
  // matches an existing row, and on the terminate branch — cheap either way.
  const freshRequest: AiRequest = {
    id: generateEntityId(),
    kind: routing.kind,
    text: ctx.text,
    createdAt: new Date().toISOString(),
    status: "pending",
    linkedTo: link,
    paragraphIds: ctx.paragraphIds,
    selectedText: ctx.selectedText,
  };

  // ONE serialized read-modify-write: `mutateAiRequests` reads the on-disk list
  // inside the write critical section, hands it to this mutator, persists the
  // result and publishes it. A `null` return means "nothing to change" — no
  // write, no publish, no spurious ledger stamp.
  const result = await mutateAiRequests(docId, (requests) => {
    // Archive intent (task 093): the card is gone, so terminate EVERY linked
    // non-terminal row — a plain-open row OR a 043-protected answered-L3
    // (`in-progress`+`resultId`) — to `complete`, regardless of current
    // openness. NOT just the first (task 253): a single card can carry two
    // non-terminal linked rows at once (an answered-L3 row closed to the drain
    // plus a fresh re-toggled `pending` row, per task 043), and archive/delete
    // means the card is gone, so all of them must close or a stray row is
    // re-served for a card that no longer exists. Byte-mirror of Python
    // `close_linked_request(force=True)` on `cmd_archive`: both stamp
    // `status: complete` + `result: "auto-applied"`. Idempotent — an unmatched
    // or already-terminal card returns `null`, so nothing is written (no
    // spurious terminal row, no needless write), and the `value` argument is
    // irrelevant here (archive is always a resolve).
    if (mode === "terminate") {
      let matched = false;
      const terminated = requests.map((r) => {
        if (!isLinkedNonTerminal(r, link)) return r;
        matched = true;
        return { ...r, status: "complete", result: "auto-applied" } as AiRequest;
      });
      return matched ? terminated : null;
    }

    const existingIdx = requests.findIndex(
      (r) =>
        r.linkedTo &&
        r.linkedTo.panel === link.panel &&
        r.linkedTo.cardId === link.cardId &&
        // Match only requests the drain still considers OPEN. `isRequestOpen` is
        // the SSOT mirror of the Python drain rule (`list_requests.py`): a
        // terminal (`complete`/`failed`) row OR an answered L3 proposal
        // (`in-progress`+`resultId`) is closed, so a re-toggle files a FRESH
        // request instead of matching a row the drain will never re-serve — and a
        // value=false toggle can't delete an answered row out from under the
        // accept/reject flow that depends on its `resultId` (task 043).
        isRequestOpen(r),
    );

    if (value) {
      if (existingIdx >= 0) {
        // Refresh context fields on re-toggle so the skill sees current anchors.
        return requests.map((r, i) =>
          i === existingIdx
            ? {
                ...r,
                text: ctx.text || r.text,
                paragraphIds: ctx.paragraphIds ?? r.paragraphIds,
                selectedText: ctx.selectedText ?? r.selectedText,
              }
            : r,
        );
      }
      return [...requests, freshRequest];
    }
    if (existingIdx < 0) return null;
    return requests.filter((_, i) => i !== existingIdx);
  });

  // The card flag is the panel's source of truth and it has already persisted,
  // so there is nothing here to roll back — but a bridged request that never
  // reached the inbox is the same silent loss the inbox's own writer had
  // (task 630): the user ticks "ask Virgil" on a note, the tick sticks, and no
  // skill will ever serve it. One channel, one voice.
  if (isAiRequestsWriteRefused(result)) {
    recordSidecarRefusal({
      docId,
      what: "request for Virgil",
      reason: result.kind === "failed" ? "failed" : result.kind,
      detail:
        result.kind === "failed" && result.error instanceof Error
          ? result.error.message
          : undefined,
    });
  }
}

/**
 * The context a bridge call carries when the CARD IS NOT IN HAND.
 *
 * Every field of `BridgeContext` is read on ONE branch of
 * `bridgeCardAiRequestFlag` — the `value=true` ADD (and its re-toggle
 * refresh). A drop (`value=false`) and a `"terminate"` both match on
 * `(panel, cardId)` and read nothing from `ctx`. So a call that is closing a
 * row needs no card, and the lifecycle forwarder in `EditorPane` has always
 * said so out loud at its own site: *"ctx fields are read only on the ADD
 * path, so a placeholder is fine."* This is that placeholder, named once.
 */
export const ABSENT_CARD_CONTEXT: BridgeContext = { text: "" };

/**
 * Bridge a card's `aiRequest` flag when the card MAY BE ABSENT from the
 * caller's snapshot — **the CONTEXT degrades, the CALL does not** (task 697).
 *
 * Every panel hook's `setXAiRequest` looks its card up in a render-time state
 * snapshot to build the ADD context, and five of them then gated the whole
 * bridge call on that lookup: `if (card) bridge(...)`. The lookup is needed
 * for exactly one thing — `text` / `paragraphIds` / `selectedText`, read only
 * when `value === true`. Gating the DROP on it made the one call that could
 * still close a stranded row skip itself for the one reason that cannot apply
 * to it, so AIWindow's Cancel — the recovery affordance for a row whose card
 * is gone — was inoperative in precisely that state: no row removed, no flag
 * changed, no error, no feedback, and `/editor/review` draining the row
 * forever. (The repo has closed the ways a row gets stranded four times over —
 * tasks 219, 313, 093, 681 — and this is the escape hatch for when they don't.)
 *
 * So the two halves are separated here, ONCE, rather than re-decided in seven
 * hooks:
 *
 *  - **card present** → today's rich context, unchanged.
 *  - **card absent + `value=false`** (a drop, or a `"terminate"`) → the call
 *    fires with `ABSENT_CARD_CONTEXT`. The row closes whether or not the card
 *    is there, which is the whole point of a retraction.
 *  - **card absent + `value=true`** (an ADD) → REFUSED, loudly in dev. There is
 *    no honest context to file, and a row linked to a card that does not exist
 *    is exactly the stranded state this function exists to clear. Mirrors the
 *    routing-less guard in `bridgeCardAiRequestFlag`: a caller bug, made a
 *    console error in dev and a no-op in prod.
 *
 * `context` is a THUNK over the found card so the caller's lookup cost and its
 * card-shaped field access stay on the branch that needs them.
 */
export function bridgeFlagForCard<C>(
  docId: string | null,
  cardKind: CardKind,
  cardId: string,
  value: boolean,
  mode: AiRequestSyncMode,
  card: C | null | undefined,
  context: (card: C) => BridgeContext,
): void {
  if (card) {
    void bridgeCardAiRequestFlag(docId, cardKind, cardId, value, context(card), mode);
    return;
  }
  if (value) {
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[ai-request-bridge] refusing to FILE a request for ${cardKind} ` +
          `"${cardId}": the card is not in its sidecar, so the row would be ` +
          `stranded at birth. (Clearing a flag needs no card and is allowed.)`,
      );
    }
    return;
  }
  void bridgeCardAiRequestFlag(
    docId,
    cardKind,
    cardId,
    false,
    ABSENT_CARD_CONTEXT,
    mode,
  );
}
